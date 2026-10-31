import {
  Bell,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  ListTodo,
  LayoutDashboard,
  LogOut,
  PackageSearch,
  ReceiptText,
  ShieldCheck,
  UserRound,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { Metric } from "@/components/metric";
import { SectionHeader } from "@/components/section-header";
import { RoleSwitcher } from "@/components/role-switcher";
import { StoreSchedulePreview } from "@/components/store-schedule-preview";
import { cleanText, employeeName } from "@/lib/display";
import { getCurrentRoleCodes } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { notificationCutoffIso } from "@/lib/notification-retention";
import { redirectInvalidSession } from "@/lib/supabase/errors";
import { scheduleStatusBadgeClass, scheduleStatusLabel } from "@/lib/schedule-status";
import { getScheduleEmployeeIds } from "@/lib/schedule-employees";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatStoreDateTime, storeTimeZone } from "@/lib/timezone";
import { isShiftOverdue } from "@/lib/shift-overdue";
import { summarizeEmployeeTaskKpi, type PreviewShift, type PreviewTask } from "@/lib/payroll/academy-payroll-preview";
import { calculateDailySalesPlan, type DailySalesActualRow, type DailySalesHistoryRow } from "@/lib/daily-sales-plan";

type ProfileRow = {
  employee_id: string | null;
  full_name: string;
  email: string | null;
  employees: { full_name: string; employee_status: "padawan" | "experienced" } | null;
};

type TaskPreview = {
  id: string;
  title: string;
  due_at: string | null;
  stores: { timezone: string | null } | null;
};

type ChecklistPreview = {
  id: string;
  submitted_at: string;
  average_score: number | string;
  stores: { name: string } | null;
  employees: { full_name: string } | null;
};

type SchedulePreview = {
  id: string;
  store_id: string;
  shift_date: string;
  status: string;
  stores: { id: string; name: string; city: string } | null;
  employee_id: string;
};

type CashCountPreview = {
  store_id: string;
  cash_amount: number | string;
  created_at: string;
};

type ManagerSchedulePreviewGroup = {
  store: { id: string; name: string; city: string } | null;
  dates: {
    date: string;
    day: string;
    weekday: string;
  }[];
  rows: Array<{
    employeeId: string;
    employeeName: string;
    statuses: Map<string, string>;
  }>;
};

type EmployeeLookupRow = {
  id: string;
  full_name: string;
};

type HomeQueryResult<T> = {
  data: T | null;
  error: { message: string } | null;
  count?: number | null;
};

type ShiftPreview = {
  id: string;
  store_id: string;
  shift_date: string;
  status: string;
  opened_at: string;
  opened_by_employee_id: string;
  stores: { name: string; timezone: string | null } | null;
  schedules: { planned_end_at: string } | null;
};

type StorePlanPreview = {
  sales_plan_amount: number | string | null;
  average_check_target: number | string | null;
  check_depth_target: number | string | null;
};

type DailyPlanActualQueryRow = {
  shift_date: string;
  shift_closing_reports: { net_revenue: number | string | null } | { net_revenue: number | string | null }[] | null;
};
type DailyPlanScheduleQueryRow = { shift_date: string };

type EmployeeKpiShiftRow = {
  id: string;
  store_id: string;
  shift_date: string;
  stores: { name: string } | null;
  shift_closing_reports: { net_revenue: number | string | null; receipt_count: number | null; items_sold_count: number | null } | { net_revenue: number | string | null; receipt_count: number | null; items_sold_count: number | null }[] | null;
  shift_participants: {
    employee_id: string;
    participant_role: "primary_seller" | "secondary_seller";
    shift_work_times: { paid_hours: number | string | null; confirmed_at: string | null } | { paid_hours: number | string | null; confirmed_at: string | null }[] | null;
  }[];
};

type StoreKpiShiftRow = {
  store_id: string;
  shift_closing_reports: { net_revenue: number | string | null; receipt_count: number | null; items_sold_count: number | null } | { net_revenue: number | string | null; receipt_count: number | null; items_sold_count: number | null }[] | null;
};

type EmployeeChecklistKpiRow = { store_id: string; average_score: number | string; stores: { name: string } | null };
type ChecklistWatchShiftRow = {
  store_id: string;
  shift_participants: Array<{ employee_id: string; employees: { full_name: string } | null }>;
};
type ChecklistWatchRow = { employee_id: string };
type StoreKpiPlanRow = StorePlanPreview & { store_id: string };
type EmployeeTaskKpiRow = {
  id: string; store_id: string | null; assignee_employee_id: string | null; created_at: string;
  due_at: string | null; completed_at: string | null; status: string; stores: { timezone: string | null } | null;
};

type EmployeeKpiStoreView = {
  id: string;
  name: string;
  shifts: number;
  confirmedShifts: number;
  confirmedHours: number;
  ownAverageCheck: number | null;
  ownCheckDepth: number | null;
  storeAverageCheck: number | null;
  storeCheckDepth: number | null;
  storeRevenue: number;
  salesPlan: number | null;
  averageTarget: number | null;
  depthTarget: number | null;
  checklistAverage: number | null;
  checklistCount: number;
};

const managementRoles = ["manager", "store_manager", "super_admin", "developer"];

const roleLabels: Record<string, string> = {
  manager: "Менеджер",
  auditor: "Проверяющий",
  store_manager: "Управляющий",
  buyer: "Закупщик",
  warehouse_manager: "Кладовщик",
  warehouse_assistant: "Помощник кладовщика",
  super_admin: "Супер-админ",
  developer: "Разработчик",
};

const statusLabels: Record<string, string> = {
  planned: "Р1",
  planned_secondary: "Р2",
  opened: "О",
  closed: "З",
  auto_closed: "З",
  cancelled: "—",
  correction_required: "Корр.",
};

function money(value: number | string | null | undefined) {
  return `${new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0))} руб.`;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function dateAtTimeZone(value: string | null, timeZone: string) {
  if (!value) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  const date = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${date.year}-${date.month}-${date.day}`;
}

function displayNumber(value: number | null, decimals = 2) {
  return value === null ? "—" : new Intl.NumberFormat("ru-RU", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}

function EmployeeKpiPanel({ period, taskKpi, stores }: { period: string; taskKpi: ReturnType<typeof summarizeEmployeeTaskKpi>; stores: EmployeeKpiStoreView[] }) {
  const periodLabel = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${period}-01T00:00:00Z`));
  const checklistRows = stores.filter((store) => store.checklistCount > 0);
  const checklistTotal = checklistRows.reduce((sum, store) => sum + store.checklistCount, 0);
  const checklistAverage = checklistTotal
    ? checklistRows.reduce((sum, store) => sum + (store.checklistAverage ?? 0) * store.checklistCount, 0) / checklistTotal
    : null;
  const shiftCount = stores.reduce((sum, store) => sum + store.shifts, 0);
  const confirmedShiftCount = stores.reduce((sum, store) => sum + store.confirmedShifts, 0);
  const confirmedHours = stores.reduce((sum, store) => sum + store.confirmedHours, 0);

  return <section className="mt-4 ui-panel p-4" aria-label={`Мои показатели за ${periodLabel}`}>
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-base font-semibold">Мои KPI · {periodLabel}</h2>
      <p className="text-xs text-muted">Показатели, используемые в расчёте премий</p>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div className="rounded-md bg-surface p-3"><p className="text-xs text-muted">Задачи в срок</p><p className="mt-1 text-lg font-semibold tabular-nums">{taskKpi.percent === null ? "—" : `${displayNumber(taskKpi.percent, 1)}%`}</p><p className="mt-1 text-xs text-muted">{taskKpi.total ? `${taskKpi.onTime} из ${taskKpi.total} · порог 95%` : "Нет задач со сроком"}</p></div>
      <div className="rounded-md bg-surface p-3"><p className="text-xs text-muted">Средний балл чек-листов</p><p className="mt-1 text-lg font-semibold tabular-nums">{displayNumber(checklistAverage)}</p><p className="mt-1 text-xs text-muted">{checklistTotal ? `${checklistTotal} проверок · порог 9,00` : "Проверок пока нет"}</p></div>
      <div className="rounded-md bg-surface p-3"><p className="text-xs text-muted">Подтверждённые смены</p><p className="mt-1 text-lg font-semibold tabular-nums">{confirmedShiftCount} / 3</p><p className="mt-1 text-xs text-muted">Всего закрыто: {shiftCount}</p></div>
      <div className="rounded-md bg-surface p-3"><p className="text-xs text-muted">Подтверждённые часы</p><p className="mt-1 text-lg font-semibold tabular-nums">{displayNumber(confirmedHours, 1)} ч</p><p className="mt-1 text-xs text-muted">Для почасовой части зарплаты</p></div>
    </div>
    <div className="mt-4">
      {stores.length ? <>
      <div className="grid gap-2 sm:hidden">
        {stores.map((store) => {
          const averageAchieved = store.averageTarget !== null && store.storeAverageCheck !== null && Math.round(store.storeAverageCheck * 100) / 100 >= store.averageTarget;
          const depthAchieved = store.depthTarget !== null && store.storeCheckDepth !== null && Math.round(store.storeCheckDepth * 100) / 100 >= store.depthTarget;
          const salesPercent = store.salesPlan && store.salesPlan > 0 ? store.storeRevenue / store.salesPlan * 100 : null;
          return <div key={store.id} className="rounded-md bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">{store.name}</h3>
              <span className="text-xs text-muted">{store.confirmedShifts}/{store.shifts} смен подтверждено</span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div><dt className="text-muted">Ваш средний чек</dt><dd className="mt-0.5 tabular-nums">{displayNumber(store.ownAverageCheck)} ₽</dd></div>
              <div><dt className="text-muted">Ваша глубина чека</dt><dd className="mt-0.5 tabular-nums">{displayNumber(store.ownCheckDepth)}</dd></div>
              <div><dt className="text-muted">Чек магазина / цель</dt><dd className={`mt-0.5 tabular-nums ${averageAchieved ? "text-emerald-300" : ""}`}>{displayNumber(store.storeAverageCheck)} / {displayNumber(store.averageTarget)} ₽</dd></div>
              <div><dt className="text-muted">Глубина / цель</dt><dd className={`mt-0.5 tabular-nums ${depthAchieved ? "text-emerald-300" : ""}`}>{displayNumber(store.storeCheckDepth)} / {displayNumber(store.depthTarget)}</dd></div>
              <div><dt className="text-muted">Оборот магазина / план</dt><dd className="mt-0.5 tabular-nums">{money(store.storeRevenue)} / {store.salesPlan && store.salesPlan > 0 ? `${money(store.salesPlan)}${salesPercent !== null ? ` · ${displayNumber(salesPercent, 1)}%` : ""}` : "не задан"}</dd></div>
              <div><dt className="text-muted">Ваши чек-листы</dt><dd className="mt-0.5 tabular-nums">{store.checklistCount ? `${displayNumber(store.checklistAverage)} · ${store.checklistCount} проверок` : "Нет проверок"}</dd></div>
              <div><dt className="text-muted">Подтверждённые смены</dt><dd className="mt-0.5 tabular-nums">{store.confirmedShifts} / 3</dd></div>
              <div><dt className="text-muted">Подтверждённые часы</dt><dd className="mt-0.5 tabular-nums">{displayNumber(store.confirmedHours, 1)} ч</dd></div>
            </dl>
          </div>;
        })}
      </div>
      <div className="hidden overflow-x-auto sm:block">
      <table className="w-full min-w-[760px] border-collapse text-left text-xs">
        <thead className="text-[10px] uppercase tracking-wide text-muted"><tr>
          <th className="px-2 py-2">Магазин</th><th className="px-2 py-2 text-right">Ваши чек / глубина</th><th className="px-2 py-2 text-right">Цели магазина: чек / глубина</th><th className="px-2 py-2 text-right">Оборот / план</th><th className="px-2 py-2 text-right">Чек-листы</th><th className="px-2 py-2 text-right">Допуск</th>
        </tr></thead>
        <tbody>{stores.map((store) => {
          const averageAchieved = store.averageTarget !== null && store.storeAverageCheck !== null && Math.round(store.storeAverageCheck * 100) / 100 >= store.averageTarget;
          const depthAchieved = store.depthTarget !== null && store.storeCheckDepth !== null && Math.round(store.storeCheckDepth * 100) / 100 >= store.depthTarget;
          const salesPercent = store.salesPlan && store.salesPlan > 0 ? store.storeRevenue / store.salesPlan * 100 : null;
          return <tr key={store.id} className="border-t border-line">
            <td className="px-2 py-2.5 font-semibold">{store.name}</td>
            <td className="px-2 py-2.5 text-right tabular-nums">{displayNumber(store.ownAverageCheck)} ₽ / {displayNumber(store.ownCheckDepth)}</td>
            <td className="px-2 py-2.5 text-right tabular-nums"><span className={averageAchieved ? "text-emerald-300" : ""}>{displayNumber(store.storeAverageCheck)} / {displayNumber(store.averageTarget)} ₽</span><br /><span className={depthAchieved ? "text-emerald-300" : ""}>{displayNumber(store.storeCheckDepth)} / {displayNumber(store.depthTarget)}</span></td>
            <td className="px-2 py-2.5 text-right tabular-nums">{money(store.storeRevenue)} / {store.salesPlan && store.salesPlan > 0 ? `${money(store.salesPlan)}${salesPercent !== null ? ` · ${displayNumber(salesPercent, 1)}%` : ""}` : "не задан"}</td>
            <td className="px-2 py-2.5 text-right tabular-nums">{store.checklistCount ? `${displayNumber(store.checklistAverage)} · ${store.checklistCount}` : "Нет проверок"}</td>
            <td className="px-2 py-2.5 text-right tabular-nums">{store.confirmedShifts} / 3 смены</td>
          </tr>;
        })}</tbody>
      </table>
      </div>
      </> : <p className="py-2 text-sm text-muted">В этом месяце пока нет закрытых смен. Показатели магазина появятся после закрытия смены.</p>}
    </div>
  </section>;
}

function StoreGoalsCard({ plan, shiftDate }: { plan: StorePlanPreview | null; shiftDate: string }) {
  const monthLabel = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${shiftDate.slice(0, 7)}-01T00:00:00Z`));
  const target = (value: number | string | null, decimals = 0) => value == null || Number(value) <= 0
    ? "Не задан"
    : new Intl.NumberFormat("ru-RU", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Number(value));

  return <div className="mt-4 rounded-md border border-line bg-black/25 p-3">
    <p className="text-sm font-semibold">План магазина · {monthLabel}</p>
    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div><p className="text-xs text-muted">Средний чек</p><p className="mt-1 font-semibold tabular-nums">{target(plan?.average_check_target ?? null)}{plan?.average_check_target != null && Number(plan.average_check_target) > 0 ? " ₽" : ""}</p></div>
      <div><p className="text-xs text-muted">Глубина чека</p><p className="mt-1 font-semibold tabular-nums">{target(plan?.check_depth_target ?? null, 2)}</p></div>
      {plan?.sales_plan_amount != null && Number(plan.sales_plan_amount) > 0 ? <div><p className="text-xs text-muted">План оборота</p><p className="mt-1 font-semibold tabular-nums">{money(plan.sales_plan_amount)}</p></div> : null}
    </div>
  </div>;
}

function DailySalesPlanCard({ target, remaining, basis, years }: { target: number; remaining: number; basis: "history" | "schedule" | "calendar"; years: number[] }) {
  const basisLabel = basis === "history"
    ? years.length === 3 ? `Тот же месяц · ${years.join(" / ")} · веса 50/30/20` : `Тот же месяц · ${years.join(" / ")} · вес по доступной истории`
    : basis === "schedule" ? "Равномерно по датам графика" : "Равномерно по дням месяца";
  return <div className="mt-3 rounded-md border border-brand/35 bg-brand/10 p-3">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <p className="text-sm font-semibold">План на день</p>
      <p className="text-xs text-muted">Основной продавец смены</p>
    </div>
    <p className="mt-1 text-2xl font-semibold tabular-nums">{money(target)}</p>
    <p className="mt-1 text-xs text-muted">Остаток месячного плана: {money(remaining)} · {basisLabel}</p>
  </div>;
}

function todayLabel() {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
}

function formatDate(value: string | null) {
  if (!value) {
    return "Без срока";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function monthEndDate(monthStartValue: string) {
  const start = new Date(`${monthStartValue}T00:00:00Z`);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

function formatGraphDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return {
    weekday: new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(date),
    day: new Intl.DateTimeFormat("ru-RU", { day: "2-digit" }).format(date),
  };
}

function localIsoDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Vladivostok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function buildManagerSchedulePreview(schedulePreview: SchedulePreview[], employeeNameById: Map<string, string>) {
  const storeGroups = new Map<
    string,
    {
      store: { id: string; name: string; city: string } | null;
      dates: Set<string>;
      rows: Map<string, { employeeId: string; employeeName: string; statuses: Map<string, string> }>;
    }
  >();

  for (const row of schedulePreview) {
    const storeKey = row.stores?.id ?? row.store_id;
    const group = storeGroups.get(storeKey) ?? {
      store: row.stores,
      dates: new Set<string>(),
      rows: new Map<string, { employeeId: string; employeeName: string; statuses: Map<string, string> }>(),
    };

    group.dates.add(row.shift_date);
    const employeeRow = group.rows.get(row.employee_id) ?? {
      employeeId: row.employee_id,
      employeeName: employeeNameById.get(row.employee_id) ?? "Сотрудник",
      statuses: new Map<string, string>(),
    };
    employeeRow.statuses.set(row.shift_date, row.status);
    group.rows.set(row.employee_id, employeeRow);
    storeGroups.set(storeKey, group);
  }

  return Array.from(storeGroups.values()).map((group) => {
    const dates = [...group.dates]
      .sort((left, right) => left.localeCompare(right))
      .slice(0, 2)
      .map((date) => ({ date, ...formatGraphDate(date) }));
    const visibleDateSet = new Set(dates.map((item) => item.date));
    const rows = [...group.rows.values()]
      .map((row) => ({
        ...row,
        statuses: new Map([...row.statuses.entries()].filter(([date]) => visibleDateSet.has(date))),
      }))
      .filter((row) => row.statuses.size > 0)
      .sort((left, right) => left.employeeName.localeCompare(right.employeeName, "ru"));

    return {
      store: group.store,
      dates,
      rows,
    } satisfies ManagerSchedulePreviewGroup;
  });
}

export default async function HomePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const profileQuery = supabase
    .from("profiles")
    .select("employee_id, full_name, email, employees(full_name, employee_status)")
    .eq("id", user.id)
    .maybeSingle<ProfileRow>();

  const accessibleStoresPromise = getAccessibleStores(supabase);
  const [profileResult, roleState] = await Promise.all([profileQuery, getCurrentRoleCodes(supabase, user)]);
  const { data: profile, error: profileError } = profileResult;

  if (profileError) {
    redirectInvalidSession(profileError);
    throw new Error(profileError.message);
  }

  const roles = roleState.roles.map((code) => ({ code, name: roleLabels[code] ?? code }));
  const allRoleCodes = roleState.allRoles;
  const roleCodes = roles.map((role) => role.code);
  const auditorOnly = roleCodes.includes("auditor") && !roleCodes.some((role) => managementRoles.includes(role));
  const storeManagerView = roleCodes.includes("store_manager") && !auditorOnly;
  const superAdminView = roleCodes.includes("super_admin") && !auditorOnly && !storeManagerView;
  const managementView = storeManagerView || superAdminView;
  const managerOnlyView = roleCodes.includes("manager") && !auditorOnly && !managementView && !roleCodes.includes("developer");
  const warehouseManagerOnlyView = roleCodes.includes("warehouse_manager") && !managementView && !roleCodes.includes("developer");
  const warehouseAssistantOnlyView = roleCodes.includes("warehouse_assistant") && !managementView && !roleCodes.includes("developer");
  const buyerOnlyView = roleCodes.includes("buyer") && !managementView && !roleCodes.includes("developer");
  const supportOnlyView = warehouseManagerOnlyView || warehouseAssistantOnlyView || buyerOnlyView;
  const canSeeAccessibleStoreSchedules = managementView || auditorOnly || warehouseManagerOnlyView || buyerOnlyView;
  const accessibleStores = await accessibleStoresPromise;
  const accessibleStoreIds = accessibleStores.map((store) => store.id);
  const hasAccessibleStores = accessibleStoreIds.length > 0;
  const cashCountsQuery =
    accessibleStoreIds.length > 0
      ? supabase
          .from("store_cash_counts")
          .select("store_id, cash_amount, created_at")
          .in("store_id", accessibleStoreIds)
          .order("created_at", { ascending: false })
          .limit(100)
          .returns<CashCountPreview[]>()
      : Promise.resolve({ data: [] as CashCountPreview[], error: null });

  const payrollQuery = supabase
    .from("payroll_entries")
    .select("total_payout_amount, created_at")
    .order("created_at", { ascending: false })
    .limit(1);

  if (profile?.employee_id) {
    payrollQuery.eq("employee_id", profile.employee_id);
  }

  const tasksQuery = managementView || auditorOnly || warehouseManagerOnlyView
    ? hasAccessibleStores
      ? supabase
          .from("tasks")
          .select("id, title, due_at, stores(timezone)")
          .in("store_id", accessibleStoreIds)
          .in("status", ["open", "in_progress", "overdue"])
          .order("due_at", { ascending: true, nullsFirst: false })
          .limit(3)
          .returns<TaskPreview[]>()
      : Promise.resolve({ data: [] as TaskPreview[], error: null })
    : profile?.employee_id
    ? supabase
        .from("tasks")
        .select("id, title, due_at, stores(timezone)")
        .eq("assignee_employee_id", profile.employee_id)
        .in("status", ["open", "in_progress", "overdue"])
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(3)
        .returns<TaskPreview[]>()
    : Promise.resolve({ data: [] as TaskPreview[], error: null });

  const personalTasksQuery = !managerOnlyView && profile?.employee_id
    ? supabase
        .from("tasks")
        .select("id, title, due_at, stores(timezone)")
        .eq("assignee_employee_id", profile.employee_id)
        .in("status", ["open", "in_progress", "overdue"])
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(3)
        .returns<TaskPreview[]>()
    : Promise.resolve({ data: [] as TaskPreview[], error: null });

  const checklistArchiveQuery =
    auditorOnly && profile?.employee_id
      ? supabase
          .from("checklist_submissions")
          .select(
            "id, submitted_at, average_score, stores(name), employees!checklist_submissions_employee_id_fkey(full_name)",
          )
          .eq("auditor_employee_id", profile.employee_id)
          .order("submitted_at", { ascending: false })
          .limit(3)
          .returns<ChecklistPreview[]>()
      : Promise.resolve({ data: [] as ChecklistPreview[], error: null });

  const selectedMonth = `${localIsoDate().slice(0, 7)}-01`;
  const checklistLocalDate = localIsoDate();
  const selectedMonthEnd = monthEndDate(selectedMonth);
  const nextMonthStart = new Date(Date.UTC(Number(selectedMonth.slice(0, 4)), Number(selectedMonth.slice(5, 7)), 1)).toISOString().slice(0, 10);
  const checklistResponsible = roleCodes.some((role) => ["store_manager", "auditor", "super_admin", "developer"].includes(role));
  const checklistWatchStores = accessibleStores.filter((store) => !/склад|warehouse/i.test(store.name));
  const checklistWatchStoreIds = checklistWatchStores.map((store) => store.id);
  const checklistWatchShiftsQuery = checklistResponsible && checklistWatchStoreIds.length
    ? supabase.from("shifts").select("store_id, shift_participants(employee_id, employees(full_name))")
        .in("store_id", checklistWatchStoreIds)
        .gte("shift_date", selectedMonth).lt("shift_date", nextMonthStart)
        .in("status", ["opened", "closed", "auto_closed", "correction_required"])
        .eq("is_erroneous", false)
        .returns<ChecklistWatchShiftRow[]>()
    : Promise.resolve({ data: [] as ChecklistWatchShiftRow[], error: null });
  const checklistWatchChecklistsQuery = checklistResponsible && checklistWatchStoreIds.length
    ? supabase.from("checklist_submissions").select("employee_id")
        .in("store_id", checklistWatchStoreIds).eq("period_month", selectedMonth)
        .returns<ChecklistWatchRow[]>()
    : Promise.resolve({ data: [] as ChecklistWatchRow[], error: null });
  const employeeKpiShiftsQuery = profile?.employee_id && !managementView && !auditorOnly
    ? supabase.from("shifts")
        .select("id, store_id, shift_date, stores(name), shift_closing_reports(net_revenue, receipt_count, items_sold_count), shift_participants!inner(employee_id, participant_role, shift_work_times(paid_hours, confirmed_at))")
        .eq("shift_participants.employee_id", profile.employee_id)
        .eq("status", "closed")
        .eq("is_erroneous", false)
        .gte("shift_date", selectedMonth)
        .lt("shift_date", nextMonthStart)
        .returns<EmployeeKpiShiftRow[]>()
    : Promise.resolve({ data: [] as EmployeeKpiShiftRow[], error: null });
  const employeeKpiChecklistsQuery = profile?.employee_id && !managementView && !auditorOnly
    ? supabase.from("checklist_submissions")
        .select("store_id, average_score, stores(name)")
        .eq("employee_id", profile.employee_id)
        .eq("period_month", selectedMonth)
        .returns<EmployeeChecklistKpiRow[]>()
    : Promise.resolve({ data: [] as EmployeeChecklistKpiRow[], error: null });
  const employeesLookupQuery =
    managementView || canSeeAccessibleStoreSchedules
      ? supabase.from("employees").select("id, full_name").eq("is_active", true).returns<EmployeeLookupRow[]>()
      : profile?.employee_id
      ? supabase.from("employees").select("id, full_name").eq("id", profile.employee_id).returns<EmployeeLookupRow[]>()
      : Promise.resolve({ data: [] as EmployeeLookupRow[], error: null });
  const schedulePreviewQuery =
    managerOnlyView && profile?.employee_id
      ? supabase
          .from("schedules")
          .select("id, store_id, shift_date, status, stores(id, name, city), employee_id")
          .eq("employee_id", profile.employee_id)
          .gte("shift_date", selectedMonth)
          .lte("shift_date", selectedMonthEnd)
          .order("shift_date", { ascending: true })
          .returns<SchedulePreview[]>()
      : canSeeAccessibleStoreSchedules
      ? accessibleStoreIds.length > 0
        ? supabase
            .from("schedules")
            .select("id, store_id, shift_date, status, stores(id, name, city), employee_id")
            .in("store_id", accessibleStoreIds)
            .gte("shift_date", selectedMonth)
            .lte("shift_date", selectedMonthEnd)
            .order("shift_date", { ascending: true })
            .returns<SchedulePreview[]>()
        : Promise.resolve({ data: [] as SchedulePreview[], error: null })
      : profile?.employee_id
      ? supabase
          .from("schedules")
          .select("id, store_id, shift_date, status, stores(id, name, city), employee_id")
          .eq("employee_id", profile.employee_id)
          .gte("shift_date", selectedMonth)
          .lte("shift_date", selectedMonthEnd)
          .order("shift_date", { ascending: true })
          .returns<SchedulePreview[]>()
      : Promise.resolve({ data: [] as SchedulePreview[], error: null });

  const [
    shiftsResult,
    tasksResult,
    personalTasksResult,
    notificationsResult,
    checklistResult,
    payrollResult,
    checklistArchiveResult,
    employeesLookupResult,
    cashCountsResult,
    schedulePreviewResult,
    scheduleEmployeeIds,
    employeeKpiShiftsResult,
    checklistWatchShiftsResult,
    checklistWatchChecklistsResult,
  ] = (await Promise.all([
    auditorOnly
      ? Promise.resolve({
          data: [] as ShiftPreview[],
          error: null,
        })
      : managementView
        ? supabase
            .from("shifts")
            .select("id, store_id, shift_date, status, opened_at, opened_by_employee_id, stores(name, timezone), schedules(planned_end_at)")
            .in("store_id", accessibleStoreIds)
            .in("status", ["opened", "correction_required"])
            .order("shift_date", { ascending: true })
            .limit(500)
            .returns<ShiftPreview[]>()
      : profile?.employee_id
        ? supabase
            .from("shifts")
            .select("id, store_id, shift_date, status, opened_at, opened_by_employee_id, stores(name, timezone), schedules(planned_end_at), shift_participants!inner(employee_id)")
            .eq("shift_participants.employee_id", profile.employee_id)
            .in("status", ["opened", "correction_required"])
            .order("shift_date", { ascending: false })
            .limit(1)
            .returns<ShiftPreview[]>()
        : Promise.resolve({ data: [] as ShiftPreview[], error: null }),
    tasksQuery,
    personalTasksQuery,
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_profile_id", user.id)
      .gte("created_at", notificationCutoffIso())
      .eq("is_read", false),
    employeeKpiChecklistsQuery,
    auditorOnly || storeManagerView || supportOnlyView ? Promise.resolve({ data: [] as { total_payout_amount: number | string }[], error: null }) : payrollQuery,
    checklistArchiveQuery,
    employeesLookupQuery,
    cashCountsQuery,
    schedulePreviewQuery,
    getScheduleEmployeeIds(supabase),
    employeeKpiShiftsQuery,
    checklistWatchShiftsQuery,
    checklistWatchChecklistsQuery,
  ])) as [
    HomeQueryResult<ShiftPreview[]>,
    HomeQueryResult<TaskPreview[]>,
    HomeQueryResult<TaskPreview[]>,
    HomeQueryResult<{ id: string }[]>,
    HomeQueryResult<EmployeeChecklistKpiRow[]>,
    HomeQueryResult<{ total_payout_amount: number | string }[]>,
    HomeQueryResult<ChecklistPreview[]>,
    HomeQueryResult<EmployeeLookupRow[]>,
    HomeQueryResult<CashCountPreview[]>,
    HomeQueryResult<SchedulePreview[]>,
    Set<string>,
    HomeQueryResult<EmployeeKpiShiftRow[]>,
    HomeQueryResult<ChecklistWatchShiftRow[]>,
    HomeQueryResult<ChecklistWatchRow[]>,
  ];

  if (shiftsResult.error) {
    redirectInvalidSession(shiftsResult.error);
    throw new Error(shiftsResult.error.message);
  }

  if (tasksResult.error) {
    redirectInvalidSession(tasksResult.error);
    throw new Error(tasksResult.error.message);
  }

  if (payrollResult.error) {
    throw new Error(payrollResult.error.message);
  }

  if (checklistArchiveResult.error) {
    throw new Error(checklistArchiveResult.error.message);
  }

  if (employeesLookupResult.error) {
    throw new Error(employeesLookupResult.error.message);
  }
  if (employeeKpiShiftsResult.error) throw new Error(employeeKpiShiftsResult.error.message);
  if (checklistWatchShiftsResult.error) throw new Error(checklistWatchShiftsResult.error.message);
  if (checklistWatchChecklistsResult.error) throw new Error(checklistWatchChecklistsResult.error.message);

  const shifts = (shiftsResult.data ?? []) as ShiftPreview[];
  const overdueShifts = managementView ? shifts.filter((shift) => isShiftOverdue(shift)) : [];
  const currentShifts = managementView ? shifts.filter((shift) => !isShiftOverdue(shift)) : shifts;
  const tasks = (tasksResult.data ?? []) as TaskPreview[];
  // Manager view already uses the personal task query for the main task block.
  const personalTasks = (managerOnlyView ? tasksResult.data ?? [] : personalTasksResult.data ?? []) as TaskPreview[];
  const checklistArchive = (checklistArchiveResult.data ?? []) as ChecklistPreview[];
  const checklistScores = checklistResult.data ?? [];
  const averageChecklist = checklistScores.length
    ? checklistScores.reduce((sum, row) => sum + Number(row.average_score), 0) / checklistScores.length
    : null;
  const activeShift = shifts[0];
  const activeShiftPlanResult = activeShift
    ? await supabase.from("store_sales_plans")
        .select("sales_plan_amount, average_check_target, check_depth_target")
        .eq("store_id", activeShift.store_id)
        .eq("period_start", `${activeShift.shift_date.slice(0, 7)}-01`)
        .maybeSingle<StorePlanPreview>()
    : { data: null, error: null };
  if (activeShiftPlanResult.error) throw new Error(activeShiftPlanResult.error.message);
  const activeShiftPlan = activeShiftPlanResult.data;
  const isPrimarySellerOnActiveShift = Boolean(
    managerOnlyView && profile?.employee_id && activeShift?.opened_by_employee_id === profile.employee_id,
  );
  const dailyPlanPeriod = activeShift?.shift_date.slice(0, 7) ?? "";
  const dailyPlanHistoryStart = dailyPlanPeriod
    ? `${Number(dailyPlanPeriod.slice(0, 4)) - 3}-${dailyPlanPeriod.slice(5, 7)}-01`
    : "";
  const dailyPlanHistoryEnd = dailyPlanPeriod ? `${dailyPlanPeriod}-01` : "";
  const dailyPlanHistoryQuery = isPrimarySellerOnActiveShift
    ? supabase.from("store_daily_historical_analytics").select("sales_date, revenue_amount, returns_amount")
        .eq("store_id", activeShift!.store_id).gte("sales_date", dailyPlanHistoryStart)
        .lt("sales_date", dailyPlanHistoryEnd).order("sales_date", { ascending: true })
        .returns<{ sales_date: string; revenue_amount: number | string; returns_amount: number | string }[]>()
    : Promise.resolve({ data: [] as { sales_date: string; revenue_amount: number | string; returns_amount: number | string }[], error: null });
  const dailyPlanActualQuery = isPrimarySellerOnActiveShift
    ? supabase.from("shifts").select("shift_date, shift_closing_reports(net_revenue)")
        .eq("store_id", activeShift!.store_id).eq("status", "closed").eq("is_erroneous", false)
        .gte("shift_date", `${dailyPlanPeriod}-01`).lt("shift_date", activeShift!.shift_date)
        .returns<DailyPlanActualQueryRow[]>()
    : Promise.resolve({ data: [] as DailyPlanActualQueryRow[], error: null });
  const dailyPlanScheduleQuery = isPrimarySellerOnActiveShift
    ? supabase.from("schedules").select("shift_date").eq("store_id", activeShift!.store_id)
        .gte("shift_date", `${dailyPlanPeriod}-01`).lte("shift_date", monthEndDate(`${dailyPlanPeriod}-01`))
        .eq("status", "planned")
        .returns<DailyPlanScheduleQueryRow[]>()
    : Promise.resolve({ data: [] as DailyPlanScheduleQueryRow[], error: null });
  const [dailyPlanHistoryResult, dailyPlanActualResult, dailyPlanScheduleResult] = await Promise.all([
    dailyPlanHistoryQuery, dailyPlanActualQuery, dailyPlanScheduleQuery,
  ]);
  for (const error of [dailyPlanHistoryResult.error, dailyPlanActualResult.error, dailyPlanScheduleResult.error]) {
    if (error) throw new Error(error.message);
  }
  const dailySalesPlan = isPrimarySellerOnActiveShift && activeShiftPlan?.sales_plan_amount != null
    ? calculateDailySalesPlan({
        period: dailyPlanPeriod,
        targetDate: activeShift!.shift_date,
        monthlyPlan: Number(activeShiftPlan.sales_plan_amount),
        historicalRows: (dailyPlanHistoryResult.data ?? []).map((row): DailySalesHistoryRow => ({
          date: row.sales_date, revenue: Number(row.revenue_amount), returns: Number(row.returns_amount),
        })),
        actualRows: (dailyPlanActualResult.data ?? []).map((row): DailySalesActualRow => ({
          date: row.shift_date, netRevenue: Number(firstRelation(row.shift_closing_reports)?.net_revenue ?? 0),
        })),
        scheduledDates: (dailyPlanScheduleResult.data ?? []).map((row) => row.shift_date),
      })
    : null;
  const employeeKpiShiftRows = employeeKpiShiftsResult.data ?? [];
  const employeeKpiStoreIds = [...new Set(employeeKpiShiftRows.map((shift) => shift.store_id))];
  const taskWindowStart = new Date(Date.parse(`${selectedMonth}T00:00:00Z`) - 86_400_000).toISOString();
  const taskWindowEnd = new Date(Date.parse(`${nextMonthStart}T00:00:00Z`) + 86_400_000).toISOString();
  const employeeTaskQuery = profile?.employee_id
    ? supabase.from("tasks").select("id, store_id, assignee_employee_id, created_at, due_at, completed_at, status, stores(timezone)")
        .eq("assignee_employee_id", profile.employee_id).gte("due_at", taskWindowStart).lt("due_at", taskWindowEnd).limit(1000).returns<EmployeeTaskKpiRow[]>()
    : Promise.resolve({ data: [] as EmployeeTaskKpiRow[], error: null });
  const storeTaskQuery = employeeKpiStoreIds.length
    ? supabase.from("tasks").select("id, store_id, assignee_employee_id, created_at, due_at, completed_at, status, stores(timezone)")
        .in("store_id", employeeKpiStoreIds).gte("due_at", taskWindowStart).lt("due_at", taskWindowEnd).limit(1000).returns<EmployeeTaskKpiRow[]>()
    : Promise.resolve({ data: [] as EmployeeTaskKpiRow[], error: null });
  const storeKpiShiftQuery = employeeKpiStoreIds.length
    ? supabase.from("shifts").select("store_id, shift_closing_reports(net_revenue, receipt_count, items_sold_count)")
        .in("store_id", employeeKpiStoreIds).eq("status", "closed").eq("is_erroneous", false)
        .gte("shift_date", selectedMonth).lt("shift_date", nextMonthStart).returns<StoreKpiShiftRow[]>()
    : Promise.resolve({ data: [] as StoreKpiShiftRow[], error: null });
  const storeKpiPlanQuery = employeeKpiStoreIds.length
    ? supabase.from("store_sales_plans").select("store_id, sales_plan_amount, average_check_target, check_depth_target")
        .in("store_id", employeeKpiStoreIds).eq("period_start", selectedMonth).eq("period_end", selectedMonthEnd).returns<StoreKpiPlanRow[]>()
    : Promise.resolve({ data: [] as StoreKpiPlanRow[], error: null });
  const [employeeTaskResult, storeTaskResult, storeKpiShiftResult, storeKpiPlanResult] = await Promise.all([
    employeeTaskQuery, storeTaskQuery, storeKpiShiftQuery, storeKpiPlanQuery,
  ]);
  for (const error of [employeeTaskResult.error, storeTaskResult.error, storeKpiShiftResult.error, storeKpiPlanResult.error]) {
    if (error) throw new Error(error.message);
  }
  const employeeKpiTasksById = new Map<string, EmployeeTaskKpiRow>();
  for (const row of [...(employeeTaskResult.data ?? []), ...(storeTaskResult.data ?? [])]) employeeKpiTasksById.set(row.id, row);
  const previewEmployeeShifts: PreviewShift[] = employeeKpiShiftRows.flatMap((shift) => {
    const participant = shift.shift_participants.find((item) => item.employee_id === profile?.employee_id);
    const report = firstRelation(shift.shift_closing_reports);
    if (!report || !participant) return [];
    const workTime = firstRelation(participant.shift_work_times);
    return [{
      id: shift.id,
      storeId: shift.store_id,
      shiftDate: shift.shift_date,
      paidHours: Number(workTime?.paid_hours ?? 0),
      confirmedHours: Boolean(workTime?.confirmed_at && workTime.paid_hours !== null),
      participantRole: participant.participant_role,
      netRevenue: Number(report.net_revenue ?? 0),
      receiptCount: Number(report.receipt_count ?? 0),
      itemsSoldCount: report.items_sold_count === null ? null : Number(report.items_sold_count),
    }];
  });
  const previewEmployeeTasks: PreviewTask[] = [...employeeKpiTasksById.values()].map((task) => {
    const timeZone = storeTimeZone(task.stores?.timezone);
    return {
      id: task.id,
      storeId: task.store_id ?? "",
      assigneeEmployeeId: task.assignee_employee_id,
      createdLocalDate: dateAtTimeZone(task.created_at, timeZone) ?? selectedMonth,
      dueLocalDate: dateAtTimeZone(task.due_at, timeZone),
      dueAt: task.due_at,
      completedAt: task.completed_at,
      status: task.status === "done" ? "done" : task.status === "cancelled" ? "cancelled" : "open",
    };
  });
  const employeeTaskKpi = profile?.employee_id
    ? summarizeEmployeeTaskKpi({ id: profile.employee_id, shifts: previewEmployeeShifts }, previewEmployeeTasks, selectedMonth.slice(0, 7))
    : { total: 0, onTime: 0, percent: null };
  const employeeKpiStoreData = new Map<string, EmployeeKpiStoreView>();
  for (const shift of employeeKpiShiftRows) {
    const row = employeeKpiStoreData.get(shift.store_id) ?? {
      id: shift.store_id, name: shift.stores?.name ?? "Магазин", shifts: 0, confirmedShifts: 0, confirmedHours: 0,
      ownAverageCheck: null, ownCheckDepth: null, storeAverageCheck: null, storeCheckDepth: null,
      storeRevenue: 0, salesPlan: null, averageTarget: null, depthTarget: null, checklistAverage: null, checklistCount: 0,
    };
    const participant = shift.shift_participants.find((item) => item.employee_id === profile?.employee_id);
    const workTime = firstRelation(participant?.shift_work_times);
    row.shifts++;
    if (workTime?.confirmed_at && workTime.paid_hours !== null) {
      row.confirmedShifts++;
      row.confirmedHours += Number(workTime.paid_hours);
    }
    employeeKpiStoreData.set(shift.store_id, row);
  }
  const ownMetricByStore = new Map<string, { revenue: number; receipts: number; items: number; itemReceipts: number; missingItems: boolean }>();
  for (const shift of previewEmployeeShifts) {
    const current = ownMetricByStore.get(shift.storeId) ?? { revenue: 0, receipts: 0, items: 0, itemReceipts: 0, missingItems: false };
    current.revenue += shift.netRevenue;
    current.receipts += shift.receiptCount;
    if (shift.itemsSoldCount === null) current.missingItems = true;
    else { current.items += shift.itemsSoldCount; current.itemReceipts += shift.receiptCount; }
    ownMetricByStore.set(shift.storeId, current);
  }
  const storeMetricById = new Map<string, { revenue: number; receipts: number; items: number; missingItems: boolean }>();
  for (const shift of storeKpiShiftResult.data ?? []) {
    const current = storeMetricById.get(shift.store_id) ?? { revenue: 0, receipts: 0, items: 0, missingItems: false };
    const report = firstRelation(shift.shift_closing_reports);
    if (report) {
      current.revenue += Number(report.net_revenue ?? 0);
      current.receipts += Number(report.receipt_count ?? 0);
      if (report.items_sold_count === null) current.missingItems = true;
      else current.items += Number(report.items_sold_count);
    }
    storeMetricById.set(shift.store_id, current);
  }
  const storePlansById = new Map((storeKpiPlanResult.data ?? []).map((plan) => [plan.store_id, plan]));
  const checklistTotalsByStore = new Map<string, { total: number; count: number }>();
  for (const checklist of checklistResult.data ?? []) {
    const total = checklistTotalsByStore.get(checklist.store_id) ?? { total: 0, count: 0 };
    total.total += Number(checklist.average_score);
    total.count++;
    checklistTotalsByStore.set(checklist.store_id, total);
    const store = employeeKpiStoreData.get(checklist.store_id);
    if (store) {
      store.checklistCount++;
      store.checklistAverage = (store.checklistAverage ?? 0) + Number(checklist.average_score);
    }
  }
  for (const store of employeeKpiStoreData.values()) {
    const own = ownMetricByStore.get(store.id);
    const storeMetric = storeMetricById.get(store.id);
    const plan = storePlansById.get(store.id);
    const checklist = checklistTotalsByStore.get(store.id);
    store.ownAverageCheck = own && own.receipts > 0 ? own.revenue / own.receipts : null;
    store.ownCheckDepth = own && own.receipts > 0 && !own.missingItems && own.itemReceipts > 0 ? own.items / own.itemReceipts : null;
    store.storeAverageCheck = storeMetric && storeMetric.receipts > 0 ? storeMetric.revenue / storeMetric.receipts : null;
    store.storeCheckDepth = storeMetric && storeMetric.receipts > 0 && !storeMetric.missingItems ? storeMetric.items / storeMetric.receipts : null;
    store.storeRevenue = storeMetric?.revenue ?? 0;
    store.salesPlan = plan?.sales_plan_amount == null ? null : Number(plan.sales_plan_amount);
    store.averageTarget = plan?.average_check_target == null ? null : Number(plan.average_check_target);
    store.depthTarget = plan?.check_depth_target == null ? null : Number(plan.check_depth_target);
    store.checklistAverage = checklist?.count ? checklist.total / checklist.count : null;
  }
  const employeeKpiStores = [...employeeKpiStoreData.values()].sort((left, right) => left.name.localeCompare(right.name, "ru"));
  const payrollPreview = payrollResult.data?.[0]?.total_payout_amount ?? 0;
  const latestCashCountByStore = new Map<string, CashCountPreview>();
  for (const cashCount of cashCountsResult.data ?? []) {
    if (!latestCashCountByStore.has(cashCount.store_id)) latestCashCountByStore.set(cashCount.store_id, cashCount);
  }
  const notificationsCount = notificationsResult.count ?? 0;
  const employeeNameById = new Map<string, string>(
    (employeesLookupResult.data ?? []).map((employee: EmployeeLookupRow) => [employee.id, employee.full_name] as const),
  );
  const checkedEmployeeIds = new Set((checklistWatchChecklistsResult.data ?? []).map((row) => row.employee_id));
  const missingChecklistMap = new Map<string, { id: string; name: string; storeIds: Set<string> }>();
  for (const shift of checklistWatchShiftsResult.data ?? []) {
    for (const participant of shift.shift_participants) {
      if (checkedEmployeeIds.has(participant.employee_id) || !participant.employees?.full_name) continue;
      const missing = missingChecklistMap.get(participant.employee_id) ?? { id: participant.employee_id, name: participant.employees.full_name, storeIds: new Set<string>() };
      missing.storeIds.add(shift.store_id);
      missingChecklistMap.set(participant.employee_id, missing);
    }
  }
  const missingChecklistEmployees = [...missingChecklistMap.values()]
    .map((employee) => ({
      id: employee.id,
      name: employee.name,
      stores: [...employee.storeIds].map((id) => checklistWatchStores.find((store) => store.id === id)?.name ?? "").filter(Boolean),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "ru"));
  if (schedulePreviewResult.error) {
    throw new Error(schedulePreviewResult.error.message);
  }

  const schedulePreview = (schedulePreviewResult.data ?? []).filter(
    (row) => scheduleEmployeeIds.has(row.employee_id) && employeeNameById.has(row.employee_id),
  );
  const todayIso = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowIso = localIsoDate(tomorrow);
  const managerTomorrowSchedules = schedulePreview.filter(
    (row) => row.shift_date === tomorrowIso && ["planned", "planned_secondary"].includes(row.status),
  );
  const scheduleWindowPreview = schedulePreview
    .filter((row) => [todayIso, tomorrowIso].includes(row.shift_date))
    .map((row) => ({
      id: row.id,
      shift_date: row.shift_date,
      status: row.status,
      stores: row.stores,
      employeeName: employeeNameById.get(row.employee_id) ?? "Сотрудник",
    }));
  const managerSchedulePreviewGroups = managementView ? buildManagerSchedulePreview(managerTomorrowSchedules, employeeNameById) : [];
  const routineStores = accessibleStores.filter((store) => !/склад|warehouse/i.test(store.name));
  const scheduleGroups = new Map<
    string,
    {
      store: { id: string; name: string; city: string } | null;
      rows: Map<string, { employeeId: string; employeeName: string; statuses: Map<string, string> }>;
    }
  >();

  for (const row of schedulePreview) {
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
  const accountName = employeeName(profile?.employees ?? (profile ? { full_name: profile.full_name } : null));
  const canOpenDashboard = roleCodes.some((role) => ["store_manager", "auditor", "super_admin", "developer"].includes(role));

  return (
    <main className="app-shell min-h-dvh bg-surface text-ink">
      <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pb-24 pt-4 sm:px-6 lg:px-8">
        <header className={`${managementView || managerOnlyView ? "ui-panel role-switcher-panel p-4" : "border-b border-line pb-4"} ${managementView || managerOnlyView ? "grid grid-cols-[1fr_auto] items-center gap-4" : "flex items-start justify-between gap-4"}`} data-tour="account">
          <div className={managementView || managerOnlyView ? "min-w-0" : undefined}>
            {!managementView && !managerOnlyView ? <p className="text-sm font-medium text-muted">{todayLabel()}</p> : null}
            <h1 className={managementView || managerOnlyView ? "text-xl font-semibold" : "mt-1 text-2xl font-semibold"}>
              {auditorOnly
                ? "Проверки и задачи"
                : managementView
                  ? <Link className="hover:text-brand" href="/profile">{accountName}</Link>
                  : buyerOnlyView
                    ? "Акции"
                    : warehouseManagerOnlyView || warehouseAssistantOnlyView
                      ? "Склад и задачи"
                      : managerOnlyView
                        ? <Link className="hover:text-brand" href="/profile">{accountName}</Link>
                        : "Смена и задачи"}
            </h1>
            {managementView || managerOnlyView ? (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <div data-tour="role-switcher"><RoleSwitcher activeRole={roleState.activeRole} roles={allRoleCodes} /></div>
                <form action="/logout" method="post">
                  <button className="inline-flex h-7 items-center justify-center gap-1 rounded-md bg-brand px-2 text-xs font-semibold text-white" type="submit">
                    <LogOut size={14} /> Выйти
                  </button>
                </form>
              </div>
            ) : null}
          </div>
          {(managementView || managerOnlyView) ? <Link
              className="relative grid h-12 w-12 place-items-center self-center ui-panel shadow-soft"
              style={{ overflow: "visible" }}
              aria-label="Уведомления"
              href="/notifications"
            >
              <Bell
                size={25}
                className={notificationsCount ? "relative z-10 text-brand drop-shadow-[0_0_10px_rgba(255,57,72,0.7)]" : "relative z-10"}
              />
              {notificationsCount ? (
                <span className="pointer-events-none absolute right-[-0.45rem] top-[-0.45rem] z-30 grid min-h-5 min-w-5 place-items-center rounded-full border border-white/20 bg-brand px-1 text-[10px] font-semibold leading-none text-white shadow-[0_0_12px_rgba(255,57,72,0.6)]">
                  {notificationsCount}
                </span>
              ) : null}
            </Link> : null}
        </header>

        {canOpenDashboard ? (
          <div className="mx-auto mt-3 hidden w-full max-w-5xl justify-end px-4 lg:flex sm:px-6 lg:px-8">
            <Link className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 bg-black/55 px-3 text-xs font-semibold text-white/75 transition hover:border-brand/50 hover:text-white" href="/dashboard">
              <LayoutDashboard size={15} className="text-brand" /> Операционный дашборд
            </Link>
          </div>
        ) : null}

        {checklistResponsible && Number(checklistLocalDate.slice(8, 10)) >= 20 && missingChecklistEmployees.length > 0 ? (
          <section className="mx-auto mt-4 w-full max-w-5xl px-4 sm:px-6 lg:px-8" aria-label="Сотрудники без чек-листа">
            <div className="ui-panel border-brand/45 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="font-semibold text-brand">Не проведены чек-листы</h2><p className="mt-1 text-sm text-muted">{missingChecklistEmployees.length} сотрудников без проверки за {new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${selectedMonth}T00:00:00Z`))}</p></div>
                <Link href={`/dashboard?mainTab=stores&tab=employees&employeesPeriod=${selectedMonth.slice(0, 7)}`} className="inline-flex h-9 items-center justify-center rounded-md border border-brand/45 px-3 text-sm font-semibold text-brand hover:bg-brand/10">Открыть дашборд</Link>
              </div>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {missingChecklistEmployees.map((employee) => <li key={employee.id} className="rounded-md bg-black/30 px-3 py-2 text-sm"><span className="font-medium">{employee.name}</span><span className="mt-0.5 block text-xs text-muted">{employee.stores.join(", ")}</span></li>)}
              </ul>
            </div>
          </section>
        ) : null}

        {!managerOnlyView && !managementView ? <section className="role-switcher-panel mt-4 ui-panel p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-surface">
                <UserRound className="text-brand" size={20} />
              </div>
              <div className="min-w-0">
                <Link className="block truncate text-base font-semibold hover:text-brand" href="/profile">{accountName}</Link>
                <div className="mt-1 flex items-center gap-2">
                  <div data-tour="role-switcher"><RoleSwitcher activeRole={roleState.activeRole} roles={allRoleCodes} /></div>
                  <form action="/logout" method="post">
                    <button className="inline-flex h-7 items-center justify-center gap-1 ui-panel px-2 text-xs font-semibold text-ink shadow-soft" type="submit">
                      <LogOut size={13} /> Выйти
                    </button>
                  </form>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 self-center">
              <Link
                className="relative grid h-12 w-12 place-items-center ui-panel shadow-soft"
                style={{ overflow: "visible" }}
                aria-label="Уведомления"
                href="/notifications"
              >
                <Bell
                  size={25}
                  className={notificationsCount ? "relative z-10 text-brand drop-shadow-[0_0_10px_rgba(255,57,72,0.7)]" : "relative z-10"}
                />
                {notificationsCount ? (
                  <span className="pointer-events-none absolute right-[-0.45rem] top-[-0.45rem] z-30 grid min-h-5 min-w-5 place-items-center rounded-full border border-white/20 bg-brand px-1 text-[10px] font-semibold leading-none text-white shadow-[0_0_12px_rgba(255,57,72,0.6)]">
                    {notificationsCount}
                  </span>
                ) : null}
              </Link>
            </div>
          </div>
        </section> : null}

        {profile?.employee_id && !managementView && !auditorOnly ? <EmployeeKpiPanel period={selectedMonth.slice(0, 7)} taskKpi={employeeTaskKpi} stores={employeeKpiStores} /> : null}

        {auditorOnly ? (
          <>
            <section className="mt-6 ui-panel p-4">
              <SectionHeader icon={ClipboardCheck} title="Архив чек-листов" action="Открыть" href="/checklists" />
              <div className="mt-4 grid gap-3">
                {checklistArchive.length === 0 ? (
                  <p className="rounded-md bg-surface p-3 text-sm text-muted">Проведённых чек-листов пока нет.</p>
                ) : (
                  checklistArchive.map((item) => (
                    <div key={item.id} className="rounded-md border border-line p-3">
                      <p className="font-medium">{formatDate(item.submitted_at)}</p>
                      <p className="mt-1 text-sm text-muted">
                        {item.stores?.name ?? "Магазин"} · {employeeName(item.employees)}
                      </p>
                      <p className="mt-1 text-sm font-semibold">Средний балл: {Number(item.average_score).toFixed(2)}</p>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="mt-6" data-tour="home-tasks">
              <SectionHeader icon={ListTodo} title="Ближайшие задачи" action="Все" href="/tasks" />
              <div className="mt-3 divide-y divide-line ui-panel shadow-soft">
                {tasks.length === 0 ? (
                  <p className="p-4 text-sm text-muted">Открытых задач нет.</p>
                ) : (
                  tasks.map((task) => (
                    <div key={task.id} className="flex items-start gap-3 p-4">
                      <CheckCircle2 className="mt-0.5 text-brand" size={18} />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{cleanText(task.title, "Задача с повреждённым текстом")}</p>
                        <p className="mt-1 text-sm text-muted">{formatStoreDateTime(task.due_at, task.stores?.timezone)}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="mt-6" data-tour="home-schedule">
              <SectionHeader icon={CalendarDays} title="График" action="Посмотреть" href="/schedule" />
              <div className="mt-3 ui-panel p-4">
                <div className="grid gap-3">
                  {managerSchedulePreviewGroups.length === 0 ? (
                    <p className="rounded-md bg-surface p-3 text-sm text-muted">Ближайших смен в графике нет.</p>
                  ) : (
                    managerSchedulePreviewGroups.map((group) => (
                      <div key={group.store?.id ?? group.store?.name ?? "store"} className="overflow-hidden rounded-md border border-line bg-surface p-3">
                        <div className="mb-3">
                          <p className="font-semibold">{group.store?.name ?? "Магазин"}</p>
                          {group.store?.city ? <p className="text-xs text-muted">{group.store.city}</p> : null}
                        </div>
                        <div className="overflow-x-auto">
                          <table className="min-w-[420px] table-fixed border-collapse text-xs">
                            <thead>
                              <tr>
                                <th className="sticky left-0 z-20 w-[180px] border border-line bg-white px-3 py-2 text-left">
                                  Сотрудник
                                </th>
                                {group.dates.map((cell) => (
                                  <th key={cell.date} className="w-[120px] border border-line bg-white px-2 py-2 text-center">
                                    <div className="font-semibold">{cell.weekday}</div>
                                    <div className="text-[11px] text-muted">{cell.day}</div>
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {group.rows.map((employeeRow) => (
                                <tr key={`${group.store?.id ?? "store"}_${employeeRow.employeeId}`}>
                                  <td className="sticky left-0 z-20 border border-line bg-white px-3 py-2 font-medium">
                                    {employeeRow.employeeName}
                                  </td>
                                  {group.dates.map((cell) => {
                                    const status = employeeRow.statuses.get(cell.date) ?? "";
                                    return (
                                      <td key={cell.date} className="border border-line px-2 py-2 text-center">
                                        <span
                                          className={`inline-flex min-w-10 items-center justify-center rounded-lg border px-2 py-1 text-xs font-black ${scheduleStatusBadgeClass(status)}`}
                                        >
                                          {scheduleStatusLabel(status)}
                                        </span>
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>
          </>
        ) : managementView ? (
          <>
            {overdueShifts.length > 0 ? <section className="mt-6 ui-panel p-4">
              <SectionHeader icon={ReceiptText} title="Незакрытые смены" />
              <div className="mt-4 grid gap-3">
                {overdueShifts.map((shift) => <Link
                  key={shift.id}
                  className="block rounded-md border border-brand/50 bg-surface p-4 transition-colors hover:border-brand"
                  href={`/shifts/close?shiftId=${shift.id}&overdue=1`}
                >
                  <p className="font-medium">{shift.stores?.name ?? "Магазин"} · {new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${shift.shift_date}T00:00:00Z`))}</p>
                  <p className="mt-1 text-sm text-muted">{employeeNameById.get(shift.opened_by_employee_id) ?? "Сотрудник"} · Закрыть смену</p>
                </Link>)}
              </div>
            </section> : null}
            <section className="mt-6 ui-panel p-4" data-tour="home-shift">
              <SectionHeader icon={ShieldCheck} title="Текущая смена" action="Архив" href="/admin/closed-shifts" />
              <div className="mt-4 grid gap-3">
                {currentShifts.length > 0 ? (
                  currentShifts.map((shift) => (
                    <div key={shift.id} className="rounded-md border border-line bg-surface p-4">
                      <p className="font-medium">{shift.stores?.name ?? "Магазин"} · {new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: storeTimeZone(shift.stores?.timezone) }).format(new Date(shift.opened_at))}</p>
                      <p className="mt-1 text-sm text-muted">{employeeNameById.get(shift.opened_by_employee_id) ?? "Менеджер"}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted">Открытых смен нет.</p>
                )}
              </div>
            </section>

            <section className="mt-6" data-tour="home-tasks">
              <SectionHeader icon={ListTodo} title="Ближайшие задачи" action="Все" href="/tasks" />
              <div className="mt-3 divide-y divide-line ui-panel shadow-soft">
                {personalTasks.length === 0 ? (
                  <p className="p-4 text-sm text-muted">Открытых задач нет.</p>
                ) : (
                  personalTasks.map((task) => (
                    <div key={task.id} className="flex items-start gap-3 p-4">
                      <CheckCircle2 className="mt-0.5 text-brand" size={18} />
                      <div className="min-w-0 flex-1">
                    <p className="font-medium">{cleanText(task.title, "Задача с повреждённым текстом")}</p>
                        <p className="mt-1 text-sm text-muted">{formatStoreDateTime(task.due_at, task.stores?.timezone)}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="mt-6" data-tour="home-routine">
              <SectionHeader icon={CalendarDays} title="Распорядок дня" action="Архив" href="/routine" />
              <div className="mt-3 grid gap-3">
                {routineStores.map((store) => {
                  const shift = currentShifts.find((item) => item.store_id === store.id);
                  return (
                    <div key={store.id} className="ui-panel p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-semibold">{store.name}</p>
                        <Link className="text-sm font-semibold text-brand" href={`/admin/routine?storeId=${store.id}`}>Изменить</Link>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <Link className="inline-flex h-11 items-center justify-center rounded-md border border-brand/40 bg-brand/10 text-sm font-semibold text-brand" href={shift ? `/routine/morning?shiftId=${shift.id}` : "/routine"}>Утро</Link>
                        <Link className="inline-flex h-11 items-center justify-center rounded-md border border-brand/40 bg-brand/10 text-sm font-semibold text-brand" href={shift ? `/routine/evening?shiftId=${shift.id}` : "/routine"}>Вечер</Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="mt-6" data-tour="home-schedule">
              <SectionHeader icon={CalendarDays} title="График работ" action="Открыть" href="/schedule" />
              <div className="mt-3 ui-panel p-4">
                <StoreSchedulePreview items={scheduleWindowPreview} today={todayIso} tomorrow={tomorrowIso} />
              </div>
            </section>
          </>
        ) : managerOnlyView ? (
          <>
            <section className="mt-6 ui-panel p-4" data-tour="home-shift">
              <SectionHeader icon={ShieldCheck} title="Текущая смена" />
              {activeShift ? (
                <>
                  <p className="mt-4 text-lg font-semibold">{activeShift.stores?.name ?? "Магазин"} {new Intl.DateTimeFormat("ru-RU").format(new Date(`${activeShift.shift_date}T00:00:00Z`))}</p>
                  <p className="mt-2 text-sm text-muted">Наличка в кассе</p>
                  <p className="mt-1 text-xl font-semibold">
                    {money(latestCashCountByStore.get(activeShift.store_id)?.cash_amount ?? 0)}
                  </p>
                  <StoreGoalsCard plan={activeShiftPlan} shiftDate={activeShift.shift_date} />
                  {dailySalesPlan ? <DailySalesPlanCard target={dailySalesPlan.target} remaining={dailySalesPlan.monthlyRemaining} basis={dailySalesPlan.basis} years={dailySalesPlan.years} /> : null}
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <Link className="inline-flex h-11 items-center justify-center rounded-md bg-brand px-3 text-sm font-semibold text-white" href={`/shifts/close?shiftId=${activeShift.id}&hideCash=1`}>Закрыть смену</Link>
                    <Link className="inline-flex h-11 items-center justify-center rounded-md ui-panel px-3 text-sm font-semibold" href={`/shifts/recount?storeId=${activeShift.store_id}&shiftId=${activeShift.id}`}>Пересчёт</Link>
                  </div>
                </>
              ) : (
                <Link className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-md bg-brand px-3 text-sm font-semibold text-white" href="/shifts/open">Открыть</Link>
              )}
            </section>

            <section className="mt-6 ui-panel p-4" data-tour="home-routine">
              <SectionHeader icon={CalendarDays} title="Распорядок" />
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Link className="inline-flex h-14 items-center justify-center rounded-md border border-brand/40 bg-brand/10 text-sm font-semibold text-brand" href="/routine/morning">Утро</Link>
                <Link className="inline-flex h-14 items-center justify-center rounded-md border border-brand/40 bg-brand/10 text-sm font-semibold text-brand" href="/routine/evening">Вечер</Link>
              </div>
            </section>

            <section className="mt-6" data-tour="home-tasks">
              <SectionHeader icon={ListTodo} title="Ближайшие задачи" action="Все" href="/tasks" />
              <div className="mt-3 divide-y divide-line ui-panel shadow-soft">
                {tasks.length === 0 ? <p className="p-4 text-sm text-muted">Открытых задач нет.</p> : tasks.map((task) => (
                  <div key={task.id} className="flex items-start gap-3 p-4"><CheckCircle2 className="mt-0.5 text-brand" size={18} /><div className="min-w-0 flex-1"><p className="font-medium">{cleanText(task.title, "Задача с повреждённым текстом")}</p><p className="mt-1 text-sm text-muted">{formatStoreDateTime(task.due_at, task.stores?.timezone)}</p></div></div>
                ))}
              </div>
            </section>

            <section className="mt-6" data-tour="home-schedule">
              <SectionHeader icon={CalendarDays} title="График" action="Посмотреть" href="/schedule" />
              <div className="mt-3 ui-panel p-4"><StoreSchedulePreview items={scheduleWindowPreview} today={todayIso} tomorrow={tomorrowIso} /></div>
            </section>
          </>
        ) : supportOnlyView ? (
          <>
            <section className="mt-6" data-tour="home-tasks">
              <SectionHeader icon={ListTodo} title="Ближайшие задачи" action="Все" href="/tasks" />
              <div className="mt-3 divide-y divide-line ui-panel shadow-soft">
                {tasks.length === 0 ? (
                  <p className="p-4 text-sm text-muted">Открытых задач нет.</p>
                ) : (
                  tasks.map((task) => (
                    <div key={task.id} className="flex items-start gap-3 p-4">
                      <CheckCircle2 className="mt-0.5 text-brand" size={18} />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{cleanText(task.title, "Задача с повреждённым текстом")}</p>
                        <p className="mt-1 text-sm text-muted">{formatStoreDateTime(task.due_at, task.stores?.timezone)}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            {buyerOnlyView || warehouseManagerOnlyView ? (
              <section className="mt-6 ui-panel p-4">
                <SectionHeader icon={PackageSearch} title="Акции" action="Открыть" href="/procurement" />
                <p className="mt-3 text-sm text-muted">
                  Заказы поставщиков, счета, статусы приемки и проблемные поставки.
                </p>
              </section>
            ) : null}

            <section className="mt-6">
              <SectionHeader icon={CalendarDays} title="График" action="Посмотреть" href="/schedule" />
              <div className="mt-3 ui-panel p-4">
                <StoreSchedulePreview items={scheduleWindowPreview} today={todayIso} tomorrow={tomorrowIso} />
              </div>
            </section>
          </>
        ) : (
          <>
            {!superAdminView ? (
              <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric icon={ReceiptText} label="К выплате" value={money(payrollPreview)} />
                <Metric icon={ClipboardCheck} label="Чек-лист" value={averageChecklist === null ? "—" : averageChecklist.toFixed(2)} />
                <Metric icon={ListTodo} label="Задачи" value={`${tasks.length} задач`} />
                <Metric icon={WalletCards} label="Уведомления" value={`${notificationsCount}`} />
              </section>
            ) : null}

            <section className="mt-6 ui-panel p-4">
          <SectionHeader icon={ShieldCheck} title="Текущая смена" action="Открыть" href="/shifts" />
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <p className="text-muted">Магазин</p>
              <p className="mt-1 font-medium">{activeShift?.stores?.name ?? "Нет смены"}</p>
            </div>
            <div>
              <p className="text-muted">Статус</p>
              <p className="mt-1 font-medium">{activeShift?.status ? statusLabels[activeShift.status] ?? activeShift.status : "—"}</p>
            </div>
            <div>
              <p className="text-muted">Дата</p>
              <p className="mt-1 font-medium">{activeShift?.shift_date ?? "-"}</p>
            </div>
          </div>
          {activeShift ? <StoreGoalsCard plan={activeShiftPlan} shiftDate={activeShift.shift_date} /> : null}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Link className="rounded-md bg-brand px-4 py-3 text-center text-sm font-semibold text-white" href="/shifts">
              Смены
            </Link>
            <Link className="ui-panel px-4 py-3 text-center text-sm font-semibold" href="/shifts/close">
              Закрытие
            </Link>
          </div>
            </section>

            <section className="mt-6">
          <SectionHeader icon={ListTodo} title="Ближайшие задачи" action="Все" href="/tasks" />
          <div className="mt-3 divide-y divide-line ui-panel shadow-soft">
            {tasks.length === 0 ? (
              <p className="p-4 text-sm text-muted">Открытых задач нет.</p>
            ) : (
              tasks.map((task) => (
                <div key={task.id} className="flex items-start gap-3 p-4">
                  <CheckCircle2 className="mt-0.5 text-brand" size={18} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{cleanText(task.title, "Задача с повреждённым текстом")}</p>
                        <p className="mt-1 text-sm text-muted">{formatStoreDateTime(task.due_at, task.stores?.timezone)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
            </section>

            <section className="mt-6">
              <SectionHeader icon={CalendarDays} title="График" action="Посмотреть" href="/schedule" />
              <div className="mt-3 ui-panel p-4">
                <StoreSchedulePreview items={scheduleWindowPreview} today={todayIso} tomorrow={tomorrowIso} />
              </div>
            </section>
          </>
        )}
      </div>
      <BottomNav />
    </main>
  );
}




