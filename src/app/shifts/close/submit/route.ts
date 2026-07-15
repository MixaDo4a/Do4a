import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const denominationIds = [
  "5000",
  "2000",
  "1000",
  "500",
  "200",
  "100",
  "50",
  "10",
  "5",
  "2",
  "1",
  "0.5",
  "0.1",
];

const MONEY_MAX = 999_999_999_999.99;
const COUNT_MAX = 999_999;

function numeric(formData: FormData, key: string, max = MONEY_MAX) {
  const raw = String(formData.get(key) ?? "").replace(",", ".").trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > max) {
    throw new Error(`Invalid number: ${key}`);
  }
  return value;
}

function integer(formData: FormData, key: string) {
  const value = numeric(formData, key, COUNT_MAX);
  return value === null ? null : Math.trunc(value);
}

function closeUrl(request: NextRequest, formData: FormData, message: string, detail?: string) {
  const url = new URL("/shifts/close", request.url);
  url.searchParams.set("message", message);
  const keysToPreserve = [
    "shift_id",
    "cash_revenue",
    "card_revenue",
    "cash_returns",
    "card_returns",
    "receipt_count",
    "items_sold_count",
    "cash_collection_amount",
    "cash_collection_comment",
    "advance_amount",
  ];
  keysToPreserve.forEach((key) => {
    const value = String(formData.get(key) ?? "").trim();
    if (value) url.searchParams.set(key === "shift_id" ? "shiftId" : key, value);
  });
  denominationIds.forEach((value) => {
    const quantity = String(formData.get(`denomination_${value}`) ?? "").trim();
    if (quantity) url.searchParams.set(`denomination_${value}`, quantity);
  });
  if (detail) url.searchParams.set("detail", detail);
  return url;
}

function safeFileName(name: string) {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "kkm-report";
}

async function uploadKkmReportPhoto(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  shiftId: string,
  formData: FormData,
) {
  const photo = formData.get("kkm_report_photo");
  if (!(photo instanceof File) || photo.size === 0) throw new Error("Photo is required");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const path = `${shiftId}/${crypto.randomUUID()}-${safeFileName(photo.name)}`;
  const contentType = photo.type || "application/octet-stream";
  const { error: uploadError } = await supabase.storage.from("shift-reports").upload(path, photo, {
    contentType,
    upsert: false,
  });
  if (uploadError) throw new Error(uploadError.message);

  const { data: fileRow, error: fileError } = await supabase
    .from("files")
    .insert({
      bucket: "shift-reports",
      path,
      mime_type: contentType,
      size_bytes: photo.size,
      uploaded_by: user?.id ?? null,
      related_entity_type: "shift",
      related_entity_id: shiftId,
    })
    .select("id")
    .single();
  if (fileError || !fileRow) throw new Error(fileError?.message ?? "File metadata was not saved");

  const { error: linkError } = await supabase.from("cash_report_files").insert({
    shift_id: shiftId,
    file_id: fileRow.id,
    uploaded_by: user?.id ?? null,
  });
  if (linkError) throw new Error(linkError.message);
}

async function recalculateShiftPayroll(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  shiftId: string,
) {
  const { data: shift, error: shiftError } = await supabase
    .from("shifts")
    .select("shift_date, opened_by_employee_id")
    .eq("id", shiftId)
    .maybeSingle();
  if (shiftError) throw new Error(shiftError.message);
  if (!shift?.shift_date || !shift.opened_by_employee_id) return;

  const { error } = await supabase.rpc("calculate_employee_payroll_period", {
    p_employee_id: shift.opened_by_employee_id,
    p_period_month: `${shift.shift_date.slice(0, 7)}-01`,
  });
  if (error) throw new Error(error.message);
}

async function notifyShiftClosed(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  shiftId: string,
) {
  const { data: shift } = await supabase
    .from("shifts")
    .select("store_id, shift_date, opened_by_employee_id")
    .eq("id", shiftId)
    .maybeSingle<{ store_id: string; shift_date: string; opened_by_employee_id: string }>();

  if (!shift) return;

  await supabase.rpc("send_employee_notification", {
    p_employee_id: shift.opened_by_employee_id,
    p_event_type: "shift_closed",
    p_title: "Смена закрыта",
    p_body: shift.shift_date,
    p_related_entity_type: "shift",
    p_related_entity_id: shiftId,
  });

  await supabase.rpc("send_store_managers_notification", {
    p_store_id: shift.store_id,
    p_event_type: "shift_closed",
    p_title: "Смена закрыта",
    p_body: shift.shift_date,
    p_related_entity_type: "shift",
    p_related_entity_id: shiftId,
  });
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const shiftId = String(formData.get("shift_id") ?? "").trim();

  if (!shiftId) return NextResponse.redirect(closeUrl(request, formData, "shift-required"), 303);

  const photo = formData.get("kkm_report_photo");
  if (!(photo instanceof File) || photo.size === 0) {
    return NextResponse.redirect(closeUrl(request, formData, "photo-required"), 303);
  }

  const hasEmptyCashCount = denominationIds.some((value) => String(formData.get(`denomination_${value}`) ?? "").trim() === "");
  if (hasEmptyCashCount) return NextResponse.redirect(closeUrl(request, formData, "cash-counts-required"), 303);

  let payload: {
    p_shift_id: string;
    p_cash_revenue: number;
    p_card_revenue: number;
    p_cash_returns: number;
    p_card_returns: number;
    p_receipt_count: number;
    p_items_sold_count: number | null;
    p_cash_collection_amount: number | null;
    p_cash_collection_comment: string | null;
    p_advance_amount: number | null;
    p_cash_counts: { denomination_id: string; quantity: number }[];
  };

  try {
    const cashCollectionAmount = numeric(formData, "cash_collection_amount");
    const cashCollectionComment = String(formData.get("cash_collection_comment") ?? "").trim();
    if ((cashCollectionAmount ?? 0) > 0 && !cashCollectionComment) {
      return NextResponse.redirect(closeUrl(request, formData, "cash-comment-required"), 303);
    }

    const cashCounts = denominationIds
      .map((value) => {
        const quantity = integer(formData, `denomination_${value}`) ?? 0;
        return {
          denomination_id: String(formData.get(`denomination_id_${value}`) ?? ""),
          quantity,
        };
      })
      .filter((row) => row.denomination_id && row.quantity > 0);

    payload = {
      p_shift_id: shiftId,
      p_cash_revenue: numeric(formData, "cash_revenue") ?? 0,
      p_card_revenue: numeric(formData, "card_revenue") ?? 0,
      p_cash_returns: numeric(formData, "cash_returns") ?? 0,
      p_card_returns: numeric(formData, "card_returns") ?? 0,
      p_receipt_count: integer(formData, "receipt_count") ?? 0,
      p_items_sold_count: integer(formData, "items_sold_count"),
      p_cash_collection_amount: cashCollectionAmount,
      p_cash_collection_comment: cashCollectionComment || null,
      p_advance_amount: numeric(formData, "advance_amount"),
      p_cash_counts: cashCounts,
    };
  } catch {
    return NextResponse.redirect(
      closeUrl(
        request,
        formData,
        "number-error",
        `Максимальная сумма: ${MONEY_MAX.toLocaleString("ru-RU")} руб., максимальное количество: ${COUNT_MAX.toLocaleString("ru-RU")}.`,
      ),
      303,
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("close_shift", payload);
  if (error) return NextResponse.redirect(closeUrl(request, formData, "close-error", error.message), 303);

  try {
    await uploadKkmReportPhoto(supabase, shiftId, formData);
  } catch (photoError) {
    const detail = photoError instanceof Error ? photoError.message : "Photo upload failed";
    return NextResponse.redirect(closeUrl(request, formData, "photo-error", detail), 303);
  }

  try {
    await recalculateShiftPayroll(supabase, shiftId);
  } catch (payrollError) {
    const detail = payrollError instanceof Error ? payrollError.message : "Payroll recalculation failed";
    const url = new URL("/shifts", request.url);
    url.searchParams.set("message", "shift-closed-payroll-error");
    url.searchParams.set("detail", detail);
    return NextResponse.redirect(url, 303);
  }

  await notifyShiftClosed(supabase, shiftId);
  return NextResponse.redirect(new URL("/shifts?message=shift-closed", request.url), 303);
}

