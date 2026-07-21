import { CalendarPlus } from "lucide-react";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { SectionHeader } from "@/components/section-header";
import { getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { employeeName } from "@/lib/display";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<{ month?: string; storeId?: string }>;
};

type StoreRow = {
  id: string;
  city: string;
  name: string;
  status: string;
};

type EmployeeRow = {
  id: string;
  full_name: string;
  employee_store_assignments: {
    store_id: string;
    is_primary: boolean;
    valid_from: string;
    valid_to: string | null;
  }[];
};

type ScheduleRow = {
  id: string;
  store_id: string;
  employee_id: string;
  status: string;
  shift_date: string;
};

type ScheduleDate = {
  date: string;
  label: string;
  dayName: string;
};

const dayStatusLabels: Record<string, string> = {
  planned: "Р1",
  planned_secondary: "Р2",
  day_off: "В",
  sick_leave: "Б",
  vacation: "О",
};

function monthStart(value?: string) {
  if (value && /^\d{4}-\d{2}$/.test(value)) {
    return `${value}-01`;
  }

  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function monthEnd(monthStartValue: string) {
  const start = new Date(`${monthStartValue}T00:00:00Z`);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

function monthLabel(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(new Date(`${value}-01T00:00:00Z`));
}

function assignmentIsActive(assignment: EmployeeRow["employee_store_assignments"][number], today: string) {
  return assignment.valid_from <= today && (!assignment.valid_to || assignment.valid_to >= today);
}

export default async function AdminSchedulePage({ searchParams }: PageProps) {
  const { month, storeId: selectedStoreParam } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { roles } = await getCurrentRoleCodes();
  if (!hasAnyRole(roles, MANAGE_ROLES)) {
    redirect("/");
  }

  const accessibleStores = await getAccessibleStores();
  const accessibleStoreIds = accessibleStores.map((store) => store.id);
  const storesResult =
    accessibleStoreIds.length > 0
      ? await supabase
          .from("stores")
          .select("id, city, name, status")
          .in("id", accessibleStoreIds)
          .order("city")
          .order("name")
          .returns<StoreRow[]>()
      : { data: [] as StoreRow[], error: null };

  if (storesResult.error) {
    throw new Error(storesResult.error.message);
  }

  const activeStores = storesResult.data.filter((store) => store.status === "active");
  const selectedStoreId = selectedStoreParam && activeStores.some((store) => store.id === selectedStoreParam) ? selectedStoreParam : activeStores[0]?.id ?? "";
  const selectedMonth = monthStart(month);
  const selectedMonthEnd = monthEnd(selectedMonth);

  const [employeesResult, schedulesResult] = await Promise.all([
    supabase
      .from("employees")
      .select("id, full_name, employee_store_assignments(store_id, is_primary, valid_from, valid_to)")
      .eq("is_active", true)
      .order("full_name")
      .returns<EmployeeRow[]>(),
    selectedStoreId
      ? supabase
          .from("schedules")
          .select("id, store_id, employee_id, status, shift_date")
          .eq("store_id", selectedStoreId)
          .gte("shift_date", selectedMonth)
          .lte("shift_date", selectedMonthEnd)
          .order("shift_date", { ascending: true })
          .returns<ScheduleRow[]>()
      : Promise.resolve({ data: [] as ScheduleRow[], error: null }),
  ]);

  if (employeesResult.error) throw new Error(employeesResult.error.message);
  if (schedulesResult.error) throw new Error(schedulesResult.error.message);

  const today = new Date().toISOString().slice(0, 10);
  const selectedStoreEmployees = employeesResult.data.filter((employee) =>
    employee.employee_store_assignments.some((assignment) => assignment.store_id === selectedStoreId && assignmentIsActive(assignment, today)),
  );
  const scheduleRows = Array.from({ length: 8 }, (_, index) => ({
    key: `row_${index}`,
    employee: selectedStoreEmployees[index] ?? null,
  }));
  const scheduleDates: ScheduleDate[] = [];
  for (let day = 1; day <= new Date(`${selectedMonthEnd}T00:00:00Z`).getUTCDate(); day += 1) {
    const current = new Date(`${selectedMonth.slice(0, 7)}-${String(day).padStart(2, "0")}T00:00:00Z`);
    scheduleDates.push({
      date: current.toISOString().slice(0, 10),
      label: String(day).padStart(2, "0"),
      dayName: new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(current),
    });
  }

  const storeSchedule = new Map<string, ScheduleRow>();
  schedulesResult.data.forEach((schedule) => {
    storeSchedule.set(`${schedule.employee_id}_${schedule.shift_date}`, schedule);
  });

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-6xl">
        <SectionHeader icon={CalendarPlus} title="Редактирование графика" showBack />
        <section className="mt-4 ui-panel p-4">
          <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]" method="get">
            <input className="h-11 rounded-md border border-line px-3" name="month" type="month" defaultValue={selectedMonth.slice(0, 7)} />
            <select className="h-11 rounded-md border border-line px-3" name="storeId" defaultValue={selectedStoreId}>
              {activeStores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}, {store.city}
                </option>
              ))}
            </select>
            <button className="h-11 rounded-md bg-brand px-4 font-semibold text-white">Показать</button>
          </form>

          <form action="/admin/schedules/bulk-save" method="post">
            <input name="month" type="hidden" value={selectedMonth.slice(0, 7)} />
            <input name="storeId" type="hidden" value={selectedStoreId} />
            <p className="mb-3 text-sm text-muted">
              {monthLabel(selectedMonth.slice(0, 7))}. В строках доступны только сотрудники выбранного магазина.
            </p>
            <div className="overflow-hidden rounded-md border border-line">
              <div className="max-w-full overflow-x-auto">
                <table className="min-w-[1700px] border-collapse text-xs">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-20 w-[220px] border border-line bg-white px-3 py-2 text-left">Сотрудник</th>
                      {scheduleDates.map((cell) => (
                        <th key={cell.date} className="w-[48px] border border-line bg-surface px-1 py-2 text-center">
                          <div className="font-semibold">{cell.dayName}</div>
                          <div className="text-[11px] text-muted">{cell.label}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {scheduleRows.map((row) => (
                      <tr key={row.key}>
                        <td className="sticky left-0 z-10 w-[220px] border border-line bg-white px-2 py-2 align-top">
                          <select className="h-9 w-full rounded border border-line px-2 text-sm" name={`employee_${row.key}`} defaultValue={row.employee?.id ?? ""}>
                            <option value="">—</option>
                            {selectedStoreEmployees.map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                {employeeName(candidate)}
                              </option>
                            ))}
                          </select>
                        </td>
                        {scheduleDates.map((cell) => {
                          const selectedEmployeeId = row.employee?.id ?? "";
                          const schedule = selectedEmployeeId ? storeSchedule.get(`${selectedEmployeeId}_${cell.date}`) : null;
                          return (
                            <td key={cell.date} className="border border-line px-1 py-1 align-top">
                              <select className="h-8 w-full rounded border border-line px-1 text-sm" name={`cell_${row.key}_${cell.date}`} defaultValue={schedule?.status ?? ""}>
                                <option value="">—</option>
                                {Object.entries(dayStatusLabels).map(([value, label]) => (
                                  <option key={value} value={value}>
                                    {label}
                                  </option>
                                ))}
                              </select>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button className="h-11 rounded-md bg-brand px-4 font-semibold text-white">Сохранить всё</button>
            </div>
          </form>
        </section>
      </div>
      <BottomNav />
    </main>
  );
}
