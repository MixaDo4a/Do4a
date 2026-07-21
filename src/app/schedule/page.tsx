import { CalendarDays } from "lucide-react";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { ScheduleReadonlyTable } from "@/components/schedule-readonly-table";
import { SectionHeader } from "@/components/section-header";
import { getAccessibleStores } from "@/lib/auth/stores";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<{ month?: string }>;
};

type ProfileRow = {
  employee_id: string | null;
};

type UserRoleRow = {
  roles: { code: string; name: string } | null;
};

type EmployeeLookupRow = {
  id: string;
  full_name: string;
};

type ScheduleRow = {
  id: string;
  store_id: string;
  shift_date: string;
  status: string;
  stores: { id: string; name: string; city: string } | null;
  employee_id: string;
};

const managementRoles = ["manager", "store_manager", "super_admin", "developer"];

function monthStartDate(value?: string) {
  if (value && /^\d{4}-\d{2}$/.test(value)) {
    return `${value}-01`;
  }

  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function monthEndDate(monthStartValue: string) {
  const start = new Date(`${monthStartValue}T00:00:00Z`);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

function monthTitle(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(new Date(`${value}-01T00:00:00Z`));
}

export default async function SchedulePage({ searchParams }: PageProps) {
  const { month } = await searchParams;
  const selectedMonth = monthStartDate(month);
  const selectedMonthEnd = monthEndDate(selectedMonth);
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [{ data: profile, error: profileError }, { data: roleRows, error: rolesError }, employeesLookupResult] = await Promise.all([
    supabase.from("profiles").select("employee_id").eq("id", user.id).maybeSingle<ProfileRow>(),
    supabase.from("user_roles").select("roles(code, name)").eq("profile_id", user.id).is("revoked_at", null).returns<UserRoleRow[]>(),
    supabase.from("employees").select("id, full_name").eq("is_active", true).returns<EmployeeLookupRow[]>(),
  ]);

  if (profileError) throw new Error(profileError.message);
  if (rolesError) throw new Error(rolesError.message);
  if (employeesLookupResult.error) throw new Error(employeesLookupResult.error.message);

  const roleCodes = roleRows.map((row) => row.roles?.code).filter((code): code is string => Boolean(code));
  const auditorOnly = roleCodes.includes("auditor") && !roleCodes.some((role) => managementRoles.includes(role));
  const managementView = roleCodes.includes("store_manager") || roleCodes.includes("super_admin") || roleCodes.includes("developer") || auditorOnly;
  const accessibleStores = await getAccessibleStores();
  const accessibleStoreIds = accessibleStores.map((store) => store.id);

  const scheduleQuery =
    managementView && accessibleStoreIds.length > 0
      ? supabase
          .from("schedules")
          .select("id, store_id, shift_date, status, stores(id, name, city), employee_id")
          .in("store_id", accessibleStoreIds)
          .gte("shift_date", selectedMonth)
          .lte("shift_date", selectedMonthEnd)
          .order("shift_date", { ascending: true })
          .returns<ScheduleRow[]>()
      : profile?.employee_id
        ? supabase
            .from("schedules")
            .select("id, store_id, shift_date, status, stores(id, name, city), employee_id")
            .eq("employee_id", profile.employee_id)
            .gte("shift_date", selectedMonth)
            .lte("shift_date", selectedMonthEnd)
            .order("shift_date", { ascending: true })
            .returns<ScheduleRow[]>()
        : Promise.resolve({ data: [] as ScheduleRow[], error: null });

  const scheduleResult = await scheduleQuery;
  if (scheduleResult.error) throw new Error(scheduleResult.error.message);

  const scheduleDates = Array.from({ length: new Date(`${selectedMonthEnd}T00:00:00Z`).getUTCDate() }, (_, index) => {
    const current = new Date(`${selectedMonth.slice(0, 7)}-${String(index + 1).padStart(2, "0")}T00:00:00Z`);
    return {
      date: current.toISOString().slice(0, 10),
      day: String(index + 1).padStart(2, "0"),
      weekday: new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(current),
    };
  });
  const employeeNameById = new Map(employeesLookupResult.data.map((employee) => [employee.id, employee.full_name]));
  const scheduleGroups = new Map<
    string,
    {
      store: { id: string; name: string; city: string } | null;
      rows: Map<string, { employeeId: string; employeeName: string; statuses: Map<string, string> }>;
    }
  >();

  for (const row of scheduleResult.data) {
    const storeKey = row.stores?.id ?? row.store_id;
    const employeeId = row.employee_id;
    const storeGroup = scheduleGroups.get(storeKey) ?? { store: row.stores, rows: new Map() };
    const employeeRow = storeGroup.rows.get(employeeId) ?? {
      employeeId,
      employeeName: employeeNameById.get(employeeId) ?? "Сотрудник",
      statuses: new Map<string, string>(),
    };
    employeeRow.statuses.set(row.shift_date, row.status);
    storeGroup.rows.set(employeeId, employeeRow);
    scheduleGroups.set(storeKey, storeGroup);
  }

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-5xl">
        <SectionHeader icon={CalendarDays} title="График" showBack />
        <section className="mt-4 ui-panel p-4">
          <form className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" method="get">
            <div>
              <p className="font-semibold">График на {monthTitle(selectedMonth.slice(0, 7))}</p>
              <p className="mt-1 text-sm text-muted">Только просмотр. Редактирование доступно в управлении.</p>
            </div>
            <div className="flex gap-2">
              <input className="h-11 rounded-md border border-line px-3" name="month" type="month" defaultValue={selectedMonth.slice(0, 7)} />
              <button className="h-11 rounded-md bg-brand px-4 font-semibold text-white">Показать</button>
            </div>
          </form>
          <ScheduleReadonlyTable dates={scheduleDates} groups={[...scheduleGroups.values()]} />
        </section>
      </div>
      <BottomNav />
    </main>
  );
}
