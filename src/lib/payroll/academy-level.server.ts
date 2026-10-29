import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_TIME_ZONE } from "@/lib/timezone";
import {
  assertPayrollMonthStart,
  resolveAcademyPayLevel,
  type AcademyPayLevel,
  type AcademyRankHistoryRow,
} from "./academy-level";

type ServerSupabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export async function loadAcademyPayLevels(
  supabase: ServerSupabase,
  employeeIds: string[],
  periodMonth: string,
): Promise<Map<string, AcademyPayLevel>> {
  assertPayrollMonthStart(periodMonth);
  const uniqueEmployeeIds = [...new Set(employeeIds)];
  const result = new Map<string, AcademyPayLevel>();
  if (uniqueEmployeeIds.length === 0) return result;

  const [employeesResult, profilesResult] = await Promise.all([
    supabase.from("employees").select("id, created_at, primary_store_id").in("id", uniqueEmployeeIds),
    supabase.from("profiles").select("id, employee_id").in("employee_id", uniqueEmployeeIds),
  ]);
  const { data: employees, error: employeesError } = employeesResult;
  const { data: profiles, error: profilesError } = profilesResult;
  if (employeesError) throw new Error(`Failed to load employees: ${employeesError.message}`);
  if (profilesError) throw new Error(`Failed to load academy profiles: ${profilesError.message}`);

  const employeeById = new Map((employees ?? []).map((employee) => [employee.id, employee]));
  const storeIds = [...new Set((employees ?? []).map((employee) => employee.primary_store_id).filter((id): id is string => Boolean(id)))];
  const { data: stores, error: storesError } = storeIds.length
    ? await supabase.from("stores").select("id, timezone").in("id", storeIds)
    : { data: [] as { id: string; timezone: string }[], error: null };
  if (storesError) throw new Error(`Failed to load store time zones: ${storesError.message}`);
  const timeZoneByStore = new Map((stores ?? []).map((store) => [store.id, store.timezone]));

  const profileIds = (profiles ?? []).map((profile) => profile.id);
  const profileByEmployee = new Map((profiles ?? []).map((profile) => [profile.employee_id, profile.id]));
  const { data: history, error: historyError } = profileIds.length
    ? await supabase
        .from("academy_rank_history")
        .select("id, user_id, rank, confirmed_at, pay_effective_from, timezone_name")
        .in("user_id", profileIds)
        .lte("pay_effective_from", periodMonth)
        .returns<AcademyRankHistoryRow[]>()
    : { data: [] as AcademyRankHistoryRow[], error: null };
  if (historyError) throw new Error(`Failed to load academy rank history: ${historyError.message}`);

  const historyByUser = new Map<string, AcademyRankHistoryRow[]>();
  for (const row of history ?? []) {
    const rows = historyByUser.get(row.user_id) ?? [];
    rows.push(row);
    historyByUser.set(row.user_id, rows);
  }

  for (const employeeId of uniqueEmployeeIds) {
    const employee = employeeById.get(employeeId);
    if (!employee) throw new Error(`Employee not visible for academy payroll level: ${employeeId}`);
    const timeZone = employee.primary_store_id
      ? timeZoneByStore.get(employee.primary_store_id)
      : DEFAULT_TIME_ZONE;
    if (!timeZone) throw new Error(`Store time zone not visible for academy payroll level: ${employeeId}`);
    const profileId = profileByEmployee.get(employeeId);
    result.set(employeeId, resolveAcademyPayLevel(
      profileId ? historyByUser.get(profileId) ?? [] : [],
      periodMonth,
      employee.created_at,
      timeZone,
    ));
  }
  return result;
}
