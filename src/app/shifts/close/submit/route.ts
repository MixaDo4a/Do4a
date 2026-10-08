import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dispatchPushNotificationsFromEvent } from "@/lib/push";
import { getCurrentEmployeeId, getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { isShiftOverdue } from "@/lib/shift-overdue";

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
    "actual_cash_amount",
    "advance_amount",
    "advance_employee_id",
  ];
  keysToPreserve.forEach((key) => {
    const value = String(formData.get(key) ?? "").trim();
    if (value) url.searchParams.set(key === "shift_id" ? "shiftId" : key, value);
  });
  if (formData.get("overdue_override") === "1") url.searchParams.set("overdue", "1");
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
  advanceRecipientEmployeeId: string | null,
) {
  const { data: shift, error: shiftError } = await supabase
    .from("shifts")
    .select("shift_date, opened_by_employee_id")
    .eq("id", shiftId)
    .maybeSingle();
  if (shiftError) throw new Error(shiftError.message);
  if (!shift?.shift_date || !shift.opened_by_employee_id) return;

  const employeeIds = new Set([shift.opened_by_employee_id, advanceRecipientEmployeeId].filter((id): id is string => Boolean(id)));
  for (const employeeId of employeeIds) {
    const { error } = await supabase.rpc("calculate_employee_payroll_period", {
      p_employee_id: employeeId,
      p_period_month: `${shift.shift_date.slice(0, 7)}-01`,
    });
    if (error) throw new Error(error.message);
  }
}

async function notifyShiftClosed(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  shiftId: string,
) {
  const { data: shift } = await supabase
    .from("shifts")
    .select("store_id, shift_date, opened_by_employee_id, stores(name, city, timezone), employees(full_name)")
    .eq("id", shiftId)
    .maybeSingle<{
      store_id: string;
      shift_date: string;
      opened_by_employee_id: string;
      stores: { name: string; city: string; timezone: string | null } | null;
      employees: { full_name: string } | null;
    }>();

  if (!shift) return;

  const timeFormatter = new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    ...(shift.stores?.timezone ? { timeZone: shift.stores.timezone } : {}),
  });
  const closedAt = timeFormatter.format(new Date());
  const storeLabel = shift.stores ? `${shift.stores.name}, ${shift.stores.city}` : shift.store_id;
  const employeeLabel = shift.employees?.full_name ?? "Сотрудник";
  const notificationBody = `${employeeLabel} ${storeLabel} ${closedAt}`;

  await supabase.rpc("send_employee_notification", {
    p_employee_id: shift.opened_by_employee_id,
    p_event_type: "shift_closed",
    p_title: "Смена закрыта",
    p_body: notificationBody,
    p_related_entity_type: "shift",
    p_related_entity_id: shiftId,
  });

  await supabase.rpc("send_store_managers_notification", {
    p_store_id: shift.store_id,
    p_event_type: "shift_closed",
    p_title: "Смена закрыта",
    p_body: notificationBody,
    p_related_entity_type: "shift",
    p_related_entity_id: shiftId,
  });
}

async function notifyCashMismatch(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  shiftId: string,
  storeId: string,
  employeeId: string,
  detail: string,
  closed = false,
) {
  const [{ data: store }, { data: employee }] = await Promise.all([
    supabase.from("stores").select("name").eq("id", storeId).maybeSingle<{ name: string }>(),
    supabase.from("employees").select("full_name").eq("id", employeeId).maybeSingle<{ full_name: string }>(),
  ]);
  const { error } = await supabase.rpc("send_store_managers_notification", {
    p_store_id: storeId,
    p_event_type: "cash_balance_mismatch",
    p_title: "Расхождение наличных при закрытии смены",
    p_body: `${store?.name ?? "Магазин"}. ${employee?.full_name ?? "Сотрудник"}. ${detail} Смена ${closed ? "закрыта управляющим" : "не закрыта"}.`,
    p_related_entity_type: "shift",
    p_related_entity_id: shiftId,
  });
  if (!error) await dispatchPushNotificationsFromEvent(supabase, {
    eventType: "cash_balance_mismatch",
    relatedEntityType: "shift",
    relatedEntityId: shiftId,
  }).catch(() => null);
  return error;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const shiftId = String(formData.get("shift_id") ?? "").trim();
  const overdueOverrideRequested = formData.get("overdue_override") === "1";

  if (!shiftId) return NextResponse.redirect(closeUrl(request, formData, "shift-required"), 303);

  const photo = formData.get("kkm_report_photo");
  if (!(photo instanceof File) || photo.size === 0) {
    return NextResponse.redirect(closeUrl(request, formData, "photo-required"), 303);
  }

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
    p_advance_employee_id: string | null;
    p_cash_counts: { denomination_id: string; quantity: number }[];
    p_actual_cash_amount: number;
  };
  try {
    const cashCollectionAmount = numeric(formData, "cash_collection_amount");
    const actualCashAmount = numeric(formData, "actual_cash_amount");
    if (actualCashAmount === null) {
      return NextResponse.redirect(closeUrl(request, formData, "actual-cash-required"), 303);
    }
    const advanceAmount = numeric(formData, "advance_amount");
    const advanceRecipientEmployeeId = String(formData.get("advance_employee_id") ?? "").trim() || null;
    if ((advanceAmount ?? 0) > 0 && !advanceRecipientEmployeeId) {
      return NextResponse.redirect(closeUrl(request, formData, "advance-recipient-required"), 303);
    }
    const cashCollectionComment = String(formData.get("cash_collection_comment") ?? "").trim();
    if ((cashCollectionAmount ?? 0) > 0 && !cashCollectionComment) {
      return NextResponse.redirect(closeUrl(request, formData, "cash-comment-required"), 303);
    }

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
      p_advance_amount: advanceAmount,
      p_advance_employee_id: advanceRecipientEmployeeId,
      p_cash_counts: [],
      p_actual_cash_amount: actualCashAmount,
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
  let closingStoreId = "";
  let closingEmployeeId = "";
  let managerMismatchDetail: string | null = null;
  {
    const [{ data: auth }, { roles }, { employeeId }] = await Promise.all([
      supabase.auth.getUser(),
      getCurrentRoleCodes(supabase),
      getCurrentEmployeeId(supabase),
    ]);
    if (!auth.user || !employeeId) return NextResponse.redirect(closeUrl(request, formData, "close-error"), 303);

    const { data: shift } = await supabase.from("shifts")
      .select("id, store_id, opened_by_employee_id, status, shift_date, schedules(planned_end_at), stores(timezone)")
      .eq("id", shiftId)
      .maybeSingle<{ id: string; store_id: string; opened_by_employee_id: string | null; status: string; shift_date: string; schedules: { planned_end_at: string } | null; stores: { timezone: string | null } | null }>();
    if (!shift || (shift.opened_by_employee_id !== employeeId && !hasAnyRole(roles, [...MANAGE_ROLES, "manager"]))) {
      return NextResponse.redirect(closeUrl(request, formData, "close-error"), 303);
    }
    if (shift.status === "closed" || shift.status === "auto_closed") {
      return NextResponse.redirect(new URL("/shifts?message=shift-closed", request.url), 303);
    }
    if (shift.status !== "opened" && shift.status !== "correction_required") {
      return NextResponse.redirect(closeUrl(request, formData, "close-error"), 303);
    }
    closingStoreId = shift.store_id;
    closingEmployeeId = employeeId;

    let managerCanCloseWithMismatch = false;
    if (overdueOverrideRequested) {
      const allowedStores = await getAccessibleStores(supabase);
      const canCloseOverdue = hasAnyRole(roles, ["store_manager", "super_admin"])
        && allowedStores.some((store) => store.id === shift.store_id)
        && isShiftOverdue(shift);
      if (!canCloseOverdue) {
        return NextResponse.redirect(closeUrl(request, formData, "close-error"), 303);
      }
      managerCanCloseWithMismatch = true;
    }

    const { data: previousCount, error: previousCountError } = await supabase
      .from("store_cash_counts")
      .select("counted_amount")
      .eq("store_id", shift.store_id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle<{ counted_amount: number | string }>();
    if (previousCountError) {
      return NextResponse.redirect(closeUrl(request, formData, "cash-count-save-error", previousCountError.message), 303);
    }
    if (!previousCount) return NextResponse.redirect(closeUrl(request, formData, "cash-counts-required"), 303);
    const expectedCashAmount = Number(previousCount.counted_amount);
    if (Number(expectedCashAmount.toFixed(2)) !== Number(payload.p_actual_cash_amount.toFixed(2))) {
      const detail = `Покупюрник: ${expectedCashAmount.toLocaleString("ru-RU")} руб.; наличные по Z-отчёту: ${payload.p_actual_cash_amount.toLocaleString("ru-RU")} руб.`;
      if (managerCanCloseWithMismatch) {
        managerMismatchDetail = detail;
      } else {
        const notificationError = await notifyCashMismatch(supabase, shift.id, shift.store_id, employeeId, detail);
        return NextResponse.redirect(closeUrl(
          request,
          formData,
          notificationError ? "cash-balance-mismatch-notify-error" : "cash-balance-mismatch",
          notificationError ? `${detail} Уведомление управляющим не отправилось: ${notificationError.message}` : detail,
        ), 303);
      }
    }
  }

  const { error } = await supabase.rpc("close_shift_with_advance_recipient", payload);
  if (error) {
    if (error.message.includes("Shift cannot be closed from status closed")) {
      return NextResponse.redirect(new URL("/shifts?message=shift-closed", request.url), 303);
    }
    if (error.message.includes("Latest cash count is required")) {
      return NextResponse.redirect(closeUrl(request, formData, "cash-counts-required"), 303);
    }
    if (error.message.includes("Cash balance mismatch")) {
      const { data: latestCount } = await supabase.from("store_cash_counts")
        .select("counted_amount")
        .eq("store_id", closingStoreId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle<{ counted_amount: number | string }>();
      const detail = `Покупюрник: ${Number(latestCount?.counted_amount ?? 0).toLocaleString("ru-RU")} руб.; наличные по Z-отчёту: ${payload.p_actual_cash_amount.toLocaleString("ru-RU")} руб.`;
      const notificationError = await notifyCashMismatch(supabase, shiftId, closingStoreId, closingEmployeeId, detail);
      return NextResponse.redirect(closeUrl(request, formData,
        notificationError ? "cash-balance-mismatch-notify-error" : "cash-balance-mismatch", detail), 303);
    }
    return NextResponse.redirect(closeUrl(request, formData, "close-error", error.message), 303);
  }

  const mismatchNotificationError = managerMismatchDetail
    ? await notifyCashMismatch(supabase, shiftId, closingStoreId, closingEmployeeId, managerMismatchDetail, true)
    : null;

  try {
    await uploadKkmReportPhoto(supabase, shiftId, formData);
  } catch (photoError) {
    try {
      await recalculateShiftPayroll(supabase, shiftId, payload.p_advance_employee_id);
    } catch (payrollError) {
      const detail = payrollError instanceof Error ? payrollError.message : "Payroll recalculation failed";
      const url = new URL("/shifts", request.url);
      url.searchParams.set("message", "shift-closed-payroll-error");
      url.searchParams.set("detail", detail);
      return NextResponse.redirect(url, 303);
    }
    const detail = photoError instanceof Error ? photoError.message : "Photo upload failed";
    return NextResponse.redirect(closeUrl(request, formData, "photo-error", detail), 303);
  }

  try {
    await recalculateShiftPayroll(supabase, shiftId, payload.p_advance_employee_id);
  } catch (payrollError) {
    const detail = payrollError instanceof Error ? payrollError.message : "Payroll recalculation failed";
    const url = new URL("/shifts", request.url);
    url.searchParams.set("message", "shift-closed-payroll-error");
    url.searchParams.set("detail", detail);
    return NextResponse.redirect(url, 303);
  }

  await notifyShiftClosed(supabase, shiftId);
  await dispatchPushNotificationsFromEvent(supabase, {
    eventType: "shift_closed",
    relatedEntityType: "shift",
    relatedEntityId: shiftId,
  }).catch(() => null);

  const successMessage = managerMismatchDetail
    ? (mismatchNotificationError ? "shift-closed-with-mismatch-notify-error" : "shift-closed-with-mismatch")
    : "shift-closed";
  const successUrl = new URL(`/shifts?message=${successMessage}`, request.url);
  if (managerMismatchDetail) successUrl.searchParams.set("detail", managerMismatchDetail);
  return NextResponse.redirect(successUrl, 303);
}


