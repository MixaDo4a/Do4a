import { NextRequest, NextResponse } from "next/server";
import { getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function adminUrl(request: NextRequest, message: string, detail?: string) {
  const url = new URL("/admin", request.url);
  url.searchParams.set("message", message);
  if (detail) url.searchParams.set("detail", detail);
  return url;
}

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

const allowedStatuses = new Set(["planned", "planned_secondary", "day_off", "sick_leave", "vacation"]);

function scheduleField(employeeId: string, date: string) {
  return `cell_${employeeId}_${date}`;
}

function parseRowKey(key: string) {
  const match = /^employee_(.+)$/.exec(key);
  return match?.[1] ?? null;
}

function vladivostokDateTime(date: string) {
  return `${date}T10:00:00+10:00`;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const month = value(formData, "month");
  const storeId = value(formData, "storeId");

  if (!month || !/^\d{4}-\d{2}$/.test(month) || !storeId) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Недостаточно данных для сохранения графика."), 303);
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }

  const { roles } = await getCurrentRoleCodes();
  if (!hasAnyRole(roles, MANAGE_ROLES)) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Недостаточно прав для сохранения графика."), 303);
  }

  const start = `${month}-01`;
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 0));
  const dates: string[] = [];
  for (let day = 1; day <= endDate.getUTCDate(); day += 1) {
    dates.push(new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), day)).toISOString().slice(0, 10));
  }

  const employeeRows = new Map<string, string>();
  for (const [key, rawValue] of formData.entries()) {
    if (!key.startsWith("employee_")) continue;
    const rowKey = parseRowKey(key);
    if (!rowKey) continue;
    const employeeId = String(rawValue ?? "").trim();
    if (employeeId) employeeRows.set(rowKey, employeeId);
  }

  const { data: existingSchedules, error: existingError } = await supabase
    .from("schedules")
    .select("id, employee_id, shift_date, status")
    .eq("store_id", storeId)
    .gte("shift_date", start)
    .lte("shift_date", endDate.toISOString().slice(0, 10));
  if (existingError) {
    return NextResponse.redirect(adminUrl(request, "admin-error", existingError.message), 303);
  }

  const existingMap = new Map((existingSchedules ?? []).map((row) => [`${row.employee_id}_${row.shift_date}`, row]));
  const nextRows: Array<{ store_id: string; employee_id: string; shift_date: string; planned_start_at: string; planned_end_at: string; status: string; created_by: string; updated_by: string }> = [];

  for (const [rowKey, employeeId] of employeeRows.entries()) {
    for (const date of dates) {
      const status = value(formData, scheduleField(rowKey, date));
      if (!status || !allowedStatuses.has(status)) continue;
      nextRows.push({
        store_id: storeId,
        employee_id: employeeId,
        shift_date: date,
        planned_start_at: vladivostokDateTime(date),
        planned_end_at: `${date}T21:00:00+10:00`,
        status,
        created_by: user.id,
        updated_by: user.id,
      });
    }
  }

  const { error: deleteError } = await supabase.from("schedules").delete().eq("store_id", storeId).gte("shift_date", start).lte("shift_date", endDate.toISOString().slice(0, 10));
  if (deleteError) {
    return NextResponse.redirect(adminUrl(request, "admin-error", deleteError.message), 303);
  }

  if (nextRows.length > 0) {
    const { error: insertError } = await supabase.from("schedules").insert(nextRows);
    if (insertError) {
      return NextResponse.redirect(adminUrl(request, "admin-error", insertError.message), 303);
    }
  }

  const changedEmployees = new Map<string, { employeeId: string; changes: number }>();
  for (const [key, previous] of existingMap.entries()) {
    const next = nextRows.find((row) => `${row.employee_id}_${row.shift_date}` === key);
    if (!next || next.status !== previous.status) {
      const current = changedEmployees.get(previous.employee_id) ?? { employeeId: previous.employee_id, changes: 0 };
      current.changes += 1;
      changedEmployees.set(previous.employee_id, current);
    }
  }
  for (const row of nextRows) {
    const key = `${row.employee_id}_${row.shift_date}`;
    if (!existingMap.has(key)) {
      const current = changedEmployees.get(row.employee_id) ?? { employeeId: row.employee_id, changes: 0 };
      current.changes += 1;
      changedEmployees.set(row.employee_id, current);
    }
  }

  for (const { employeeId, changes } of changedEmployees.values()) {
    await supabase.rpc("send_employee_notification", {
      p_employee_id: employeeId,
      p_event_type: "schedule_changed",
      p_title: "График изменён",
      p_body: `Изменено смен: ${changes}.`,
      p_related_entity_type: "schedule",
      p_related_entity_id: null,
    });
  }

  return NextResponse.redirect(adminUrl(request, "schedule-created"), 303);
}



