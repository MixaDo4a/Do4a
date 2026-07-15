import { NextRequest, NextResponse } from "next/server";
import { CHECKLIST_ROLES, getCurrentRoleCodes, hasAnyRole } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function integer(formData: FormData, key: string) {
  const raw = String(formData.get(key) ?? "").trim();
  const value = Number(raw);

  if (!Number.isInteger(value)) {
    throw new Error(`Invalid integer: ${key}`);
  }

  return value;
}

function monthStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function safeFileName(name: string) {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return cleaned || "checklist-photo";
}

async function uploadChecklistItemPhotos(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  formData: FormData,
  submissionId: string,
  rows: { id: string; item_id: string }[],
  userId: string,
) {
  for (const row of rows) {
    const photo = formData.get(`photo_${row.item_id}`);

    if (!(photo instanceof File) || photo.size === 0) {
      continue;
    }

    const path = `${submissionId}/${row.item_id}/${crypto.randomUUID()}-${safeFileName(photo.name)}`;
    const contentType = photo.type || "application/octet-stream";
    const { error: uploadError } = await supabase.storage.from("checklist-photos").upload(path, photo, {
      contentType,
      upsert: false,
    });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const { data: fileRow, error: fileError } = await supabase
      .from("files")
      .insert({
        bucket: "checklist-photos",
        path,
        mime_type: contentType,
        size_bytes: photo.size,
        uploaded_by: userId,
        related_entity_type: "checklist_submission_item",
        related_entity_id: row.id,
      })
      .select("id")
      .single();

    if (fileError || !fileRow) {
      throw new Error(fileError?.message ?? "Checklist photo metadata was not saved");
    }

    const { error: linkError } = await supabase.from("checklist_submission_item_files").insert({
      submission_item_id: row.id,
      file_id: fileRow.id,
      uploaded_by: userId,
    });

    if (linkError) {
      throw new Error(linkError.message);
    }
  }
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const storeId = String(formData.get("store_id") ?? "").trim();
  const employeeId = String(formData.get("employee_id") ?? "").trim();
  const templateId = String(formData.get("template_id") ?? "").trim();
  const comment = String(formData.get("comment") ?? "").trim() || null;

  if (!storeId || !employeeId || !templateId) {
    return NextResponse.redirect(new URL("/checklists/new?message=required", request.url), 303);
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }

  const { roles } = await getCurrentRoleCodes();
  if (!hasAnyRole(roles, CHECKLIST_ROLES)) {
    return NextResponse.redirect(new URL("/checklists/new?message=access-error", request.url), 303);
  }

  const { data: auditorProfile, error: auditorError } = await supabase
    .from("profiles")
    .select("employee_id")
    .eq("id", user.id)
    .single();

  if (auditorError || !auditorProfile?.employee_id) {
    return NextResponse.redirect(new URL("/checklists/new?message=access-error", request.url), 303);
  }

  const { data: employee, error: employeeError } = await supabase
    .from("employees")
    .select("employee_status")
    .eq("id", employeeId)
    .single();

  if (employeeError || !employee) {
    return NextResponse.redirect(new URL("/checklists/new?message=employee-error", request.url), 303);
  }

  const [itemsResult, settingsResult] = await Promise.all([
    supabase
      .from("checklist_items")
      .select("id, checklist_item_weights(employee_status, weight_amount)")
      .eq("template_id", templateId)
      .eq("is_active", true),
    supabase
      .from("store_checklist_item_settings")
      .select("item_id, is_enabled, weight_padawan, weight_experienced")
      .eq("store_id", storeId)
      .returns<
        {
          item_id: string;
          is_enabled: boolean;
          weight_padawan: number;
          weight_experienced: number;
        }[]
      >(),
  ]);

  const { data: items, error: itemsError } = itemsResult;
  const { data: settings, error: settingsError } = settingsResult;

  if (itemsError || settingsError || !items || items.length === 0) {
    return NextResponse.redirect(new URL("/checklists/new?message=template-error", request.url), 303);
  }

  const settingsByItem = new Map(settings.map((row) => [row.item_id, row]));

  let rows: {
    item_id: string;
    score: number;
    weight_amount_snapshot: number;
    result_amount: number;
    comment: string | null;
  }[];

  try {
    rows = items
      .filter((item) => {
        const setting = settingsByItem.get(item.id);
        return setting ? setting.is_enabled : true;
      })
      .map((item) => {
        const score = integer(formData, `score_${item.id}`);

        if (score < 1 || score > 10) {
          throw new Error("Checklist score must be between 1 and 10");
        }

        const weights = item.checklist_item_weights as {
          employee_status: string;
          weight_amount: number | string;
        }[];
        const storeSetting = settingsByItem.get(item.id);
        const weight = storeSetting
          ? {
              weight_amount:
                employee.employee_status === "experienced"
                  ? storeSetting.weight_experienced
                  : storeSetting.weight_padawan,
            }
          : weights.find((row) => row.employee_status === employee.employee_status);

        if (!weight) {
          throw new Error("Checklist weight is missing");
        }

        const weightAmount = Number(weight.weight_amount);
        const resultAmount = Math.round(((weightAmount / 10) * score) * 100) / 100;

        return {
          item_id: item.id,
          score,
          weight_amount_snapshot: weightAmount,
          result_amount: resultAmount,
          comment: String(formData.get(`comment_${item.id}`) ?? "").trim() || null,
        };
      });
  } catch {
    return NextResponse.redirect(new URL("/checklists/new?message=save-error", request.url), 303);
  }

  const averageScore = Math.round((rows.reduce((sum, row) => sum + row.score, 0) / rows.length) * 100) / 100;
  const salaryPerShiftAmount = Math.round(rows.reduce((sum, row) => sum + row.result_amount, 0) * 100) / 100;

  const { data: submission, error: submissionError } = await supabase
    .from("checklist_submissions")
    .insert({
      template_id: templateId,
      store_id: storeId,
      employee_id: employeeId,
      auditor_employee_id: auditorProfile.employee_id,
      period_month: monthStart(),
      employee_status_snapshot: employee.employee_status,
      average_score: averageScore,
      salary_per_shift_amount: salaryPerShiftAmount,
      comment,
    })
    .select("id")
    .single();

  if (submissionError || !submission) {
    return NextResponse.redirect(new URL("/checklists/new?message=save-error", request.url), 303);
  }

  const { data: savedRows, error: rowsError } = await supabase
    .from("checklist_submission_items")
    .insert(
      rows.map((row) => ({
        ...row,
        submission_id: submission.id,
      })),
    )
    .select("id, item_id")
    .returns<{ id: string; item_id: string }[]>();

  if (rowsError || !savedRows) {
    return NextResponse.redirect(new URL("/checklists/new?message=save-error", request.url), 303);
  }

  try {
    await uploadChecklistItemPhotos(supabase, formData, submission.id, savedRows, user.id);
  } catch {
    return NextResponse.redirect(new URL("/checklists/new?message=save-error", request.url), 303);
  }

  await supabase.rpc("send_employee_notification", {
    p_employee_id: employeeId,
    p_event_type: "checklist_saved",
    p_title: "Новый чек-лист",
    p_body: `Средний балл: ${averageScore.toFixed(2)}`,
    p_related_entity_type: "checklist_submission",
    p_related_entity_id: submission.id,
  });

  await supabase.rpc("send_store_employees_notification", {
    p_store_id: storeId,
    p_event_type: "checklist_saved",
    p_title: "Новый чек-лист",
    p_body: `Проверка магазина ${storeId}`,
    p_exclude_employee_id: employeeId,
    p_related_entity_type: "checklist_submission",
    p_related_entity_id: submission.id,
  });

  await supabase.rpc("send_store_managers_notification", {
    p_store_id: storeId,
    p_event_type: "checklist_saved",
    p_title: "Новый чек-лист",
    p_body: `Средний балл: ${averageScore.toFixed(2)}`,
    p_related_entity_type: "checklist_submission",
    p_related_entity_id: submission.id,
  });

  return NextResponse.redirect(
    new URL(`/checklists/new?message=saved&salary=${salaryPerShiftAmount}&score=${averageScore}`, request.url),
    303,
  );
}

