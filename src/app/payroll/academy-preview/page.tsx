import { WalletCards } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { SectionHeader } from "@/components/section-header";
import { getCurrentRoleCodes, hasAnyRole } from "@/lib/auth/roles";
import { loadAcademyPayLevels } from "@/lib/payroll/academy-level.server";
import {
  calculateAcademyPayrollPreview,
  type PreviewEmployee,
  type PreviewRate,
  type PreviewShift,
  type PreviewStore,
  type PreviewTask,
} from "@/lib/payroll/academy-payroll-preview";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_TIME_ZONE } from "@/lib/timezone";

type PageProps = { searchParams: Promise<{ period?: string }> };
type Relation<T> = T | T[] | null;
type StoreRow = {
  id: string; name: string; timezone: string | null;
  workday_start_time: string | null; workday_end_time: string | null;
};
type ReportRow = {
  net_revenue: number | string; receipt_count: number; items_sold_count: number | null;
};
type ParticipantRow = {
  employee_id: string; participant_role: "primary_seller" | "secondary_seller";
  employees: Relation<{ id: string; full_name: string }>;
  shift_work_times: Relation<{ paid_hours: number | string | null; confirmed_at: string | null }>;
};
type ShiftRow = {
  id: string; store_id: string; shift_date: string;
  stores: Relation<StoreRow>;
  shift_closing_reports: Relation<ReportRow>;
  shift_participants: ParticipantRow[];
};
type EmployeeRow = { id: string; full_name: string; created_at: string; hired_at: string; terminated_at: string | null; is_active: boolean };
type ChecklistRow = { employee_id: string; store_id: string; average_score: number | string };
type TaskRow = {
  id: string; store_id: string | null; assignee_employee_id: string | null;
  created_at: string; due_at: string | null; completed_at: string | null;
  status: "open" | "in_progress" | "done" | "overdue" | "cancelled";
  stores: Relation<{ timezone: string | null }>;
};
type RateRow = {
  id: number; level: number; effective_from: string;
  hourly_rate: number | string; base_commission_percent: number | string;
  plan_commission_percent: number | string;
};
type PlanRow = {
  store_id: string; sales_plan_amount: number | string;
  average_check_target?: number | string | null; check_depth_target?: number | string | null;
};
type AdjustmentRow = { employee_id: string; adjustment_type: string; amount: number | string };
type InventoryRow = {
  employee_id: string; amount: number | string;
  inventory_periods: Relation<{ period_start: string; period_end: string }>;
};
type AssignmentRow = {
  employee_id: string; store_id: string; valid_from: string; valid_to: string | null;
};

const OCTOBER_TARGETS: Record<string, { average: number; depth: number }> = {
  "10000000-0000-0000-0000-000000000001": { average: 3042.93, depth: 2.54 },
  "11884b8f-c37d-4c04-9e8a-a1f51c936108": { average: 2363.66, depth: 2.89 },
  "f1130dc6-eaf6-4bfb-b173-1fd61f51dc85": { average: 453.82, depth: 1.4 },
  "29642677-1ed0-49f6-b9f7-508a6f02c8dc": { average: 942.93, depth: 2.09 },
};
const OCTOBER_PACKAGES: Record<string, number> = {
  "Лиза Крючкова": 5_000,
  "Кочкин Николай": 5_000,
  "Дмитрий Прусенко": 5_000,
  "Никита Хитров": 5_000,
};
const OCTOBER_LEVEL_FOUR: PreviewRate = {
  level: 4, hourlyRate: 280, baseCommissionPercent: 2, planCommissionPercent: 2,
};
const DEFAULT_RATES: PreviewRate[] = [
  [210, 1], [240, 1.5], [260, 2], [280, 2], [300, 2],
  [320, 2], [340, 2], [360, 2], [380, 2], [400, 2],
].map(([hourlyRate, commission], index) => ({
  level: index + 1,
  hourlyRate,
  baseCommissionPercent: commission,
  planCommissionPercent: index + 1 >= 5 ? 2.5 : commission,
}));

function one<T>(value: Relation<T>): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function localDate(value: string | null, timeZone: string): string | null {
  if (!value) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function hoursBetween(start: string | null, end: string | null): number {
  if (!start || !end) return 0;
  const parse = (value: string) => {
    const [hour, minute] = value.split(":").map(Number);
    return hour * 60 + minute;
  };
  let minutes = parse(end) - parse(start);
  if (minutes < 0) minutes += 24 * 60;
  return minutes / 60;
}

function money(value: number) {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)} ₽`;
}

export default async function AcademyPayrollPreviewPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const month = params.period && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.period)
    ? params.period
    : "2026-10";
  const periodStart = `${month}-01`;
  const nextMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1))
    .toISOString().slice(0, 10);
  const isOctoberSimulation = month === "2026-10";
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { roles } = await getCurrentRoleCodes(supabase, user);
  if (!hasAnyRole(roles, ["super_admin", "developer"])) redirect("/payroll");

  const [employeesResult, storesResult, shiftsResult, checklistsResult, ratesResult, plansResult, tasksResult] = await Promise.all([
    supabase.from("employees").select("id, full_name, created_at, hired_at, terminated_at, is_active").order("full_name").returns<EmployeeRow[]>(),
    supabase.from("stores").select("id, name, timezone, workday_start_time, workday_end_time").eq("status", "active").returns<StoreRow[]>(),
    supabase.from("shifts").select(`id, store_id, shift_date, stores!inner(id, name, timezone, workday_start_time, workday_end_time), shift_closing_reports(net_revenue, receipt_count, items_sold_count), shift_participants(employee_id, participant_role, employees(id, full_name), shift_work_times(paid_hours, confirmed_at))`)
      .eq("status", "closed").gte("shift_date", periodStart).lt("shift_date", nextMonth).returns<ShiftRow[]>(),
    supabase.from("checklist_submissions").select("employee_id, store_id, average_score").eq("period_month", periodStart).returns<ChecklistRow[]>(),
    supabase.from("academy_pay_rates").select("id, level, effective_from, hourly_rate, base_commission_percent, plan_commission_percent").lte("effective_from", periodStart).order("effective_from", { ascending: false }).order("id", { ascending: false }).returns<RateRow[]>(),
    supabase.from("store_sales_plans").select("store_id, sales_plan_amount, average_check_target, check_depth_target").eq("period_start", periodStart).eq("period_end", new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10)).returns<PlanRow[]>(),
    supabase.from("tasks").select("id, store_id, assignee_employee_id, created_at, due_at, completed_at, status, stores(timezone)").gte("due_at", new Date(Date.parse(`${periodStart}T00:00:00Z`) - 86_400_000).toISOString()).lt("due_at", new Date(Date.parse(`${nextMonth}T00:00:00Z`) + 86_400_000).toISOString()).returns<TaskRow[]>(),
  ]);

  for (const [label, error] of [
    ["employees", employeesResult.error], ["stores", storesResult.error], ["shifts", shiftsResult.error], ["checklists", checklistsResult.error],
  ] as const) if (error) throw new Error(`Не удалось загрузить ${label}: ${error.message}`);

  const warnings: string[] = [];
  if (ratesResult.error && !isOctoberSimulation) warnings.push("Таблица ставок Академии ещё не доступна в Supabase; использована согласованная начальная сетка ставок.");
  if (!ratesResult.error && !ratesResult.data?.length && !isOctoberSimulation) warnings.push("Ставки Академии ещё не заданы в базе; использована согласованная начальная сетка ставок.");
  if (plansResult.error && !isOctoberSimulation) warnings.push("Цели среднего и длины чека не прочитаны. KPI не включены в итог; требуется настройка целей или ручной расчёт.");
  if (tasksResult.error) warnings.push("Задачи за месяц не удалось загрузить; премия за задачи может быть неполной.");
  const stores = storesResult.data ?? [];
  const monthEnd = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const employees = (employeesResult.data ?? []).filter((employee) => employee.hired_at <= monthEnd && (!employee.terminated_at || employee.terminated_at >= periodStart));
  const storeById = new Map(stores.map((store) => [store.id, store]));
  const plansByStore = new Map((plansResult.data ?? []).map((plan) => [plan.store_id, plan]));
  const salesPlanFallback = plansResult.error
    ? await supabase.from("store_sales_plans").select("store_id, sales_plan_amount").eq("period_start", periodStart).eq("period_end", monthEnd).returns<{ store_id: string; sales_plan_amount: number | string }[]>()
    : null;
  const salesPlanByStore = new Map((salesPlanFallback?.data ?? []).map((plan) => [plan.store_id, Number(plan.sales_plan_amount)]));
  if (isOctoberSimulation) {
    warnings.push("Октябрь — тестовый месяц: LVL4, полный график магазина, цели KPI и четыре пакета заданы только для симуляции.");
  } else {
    warnings.push("Назначение и подтверждение пакетов наставничества/работы сети ещё не подключены к расчётным данным; пакетные премии, кроме октябрьской тестовой симуляции, не включены.");
  }

  const employeeIds = employees.map((employee) => employee.id);
  const levels = isOctoberSimulation
    ? new Map(employeeIds.map((id) => [id, { status: "ready" as const, level: 4, source: "default" as const, history: null }]))
    : await loadAcademyPayLevels(supabase, employeeIds, periodStart);

  const shiftRows = shiftsResult.data ?? [];
  const previewShiftsByEmployee = new Map<string, PreviewShift[]>();
  const previewStores: PreviewStore[] = stores.map((store) => {
    const monthShifts = shiftRows.filter((shift) => shift.store_id === store.id);
    const reports = monthShifts.map((shift) => one(shift.shift_closing_reports)).filter((row): row is ReportRow => Boolean(row));
    const target = isOctoberSimulation ? OCTOBER_TARGETS[store.id] : null;
    const plan = plansByStore.get(store.id);
    const hasUnknownItemCount = reports.some((report) => report.items_sold_count === null);
    if (!isOctoberSimulation && hasUnknownItemCount) warnings.push(`${store.name}: в закрытиях есть смены без числа товаров; глубина чека помечена как неопределённая.`);
    if (!isOctoberSimulation && plan && (plan.average_check_target == null || plan.check_depth_target == null)) {
      warnings.push(`${store.name}: KPI-цели заполнены не полностью; ручной расчёт необходим для отсутствующего показателя.`);
    }
    if (!isOctoberSimulation && !plan) warnings.push(`${store.name}: план продаж и KPI-цели на ${month} не заданы.`);
    return {
      id: store.id,
      workdayHours: hoursBetween(store.workday_start_time, store.workday_end_time),
      netRevenue: reports.reduce((sum, report) => sum + Number(report.net_revenue), 0),
      receiptCount: reports.reduce((sum, report) => sum + report.receipt_count, 0),
      itemsSoldCount: hasUnknownItemCount && !isOctoberSimulation ? null : reports.reduce((sum, report) => sum + (report.items_sold_count ?? 0), 0),
      averageCheckTarget: target?.average ?? (plan?.average_check_target == null ? null : Number(plan.average_check_target)),
      checkDepthTarget: target?.depth ?? (plan?.check_depth_target == null ? null : Number(plan.check_depth_target)),
      salesPlanAmount: plan ? Number(plan.sales_plan_amount) : salesPlanByStore.get(store.id) ?? null,
    };
  });

  for (const shift of shiftRows) {
    const report = one(shift.shift_closing_reports);
    if (!report) continue;
    for (const participant of shift.shift_participants ?? []) {
      const employee = one(participant.employees);
      if (!employee) continue;
      const workTime = one(participant.shift_work_times);
      const rows = previewShiftsByEmployee.get(participant.employee_id) ?? [];
      rows.push({
        id: shift.id,
        storeId: shift.store_id,
        shiftDate: shift.shift_date,
        paidHours: Number(workTime?.paid_hours ?? 0),
        confirmedHours: Boolean(workTime?.confirmed_at && workTime.paid_hours !== null),
        participantRole: participant.participant_role,
        netRevenue: Number(report.net_revenue),
        receiptCount: report.receipt_count,
        itemsSoldCount: report.items_sold_count,
      });
      previewShiftsByEmployee.set(participant.employee_id, rows);
    }
  }

  const tasks = (tasksResult.data ?? []).map((task): PreviewTask => {
    const store = task.store_id ? storeById.get(task.store_id) : undefined;
    const timeZone = store?.timezone ?? one(task.stores)?.timezone ?? DEFAULT_TIME_ZONE;
    return {
      id: task.id,
      storeId: task.store_id ?? "",
      assigneeEmployeeId: task.assignee_employee_id,
      createdLocalDate: localDate(task.created_at, timeZone) ?? periodStart,
      dueLocalDate: localDate(task.due_at, timeZone),
      dueAt: task.due_at,
      completedAt: task.completed_at,
      status: task.status === "done" ? "done" : task.status === "cancelled" ? "cancelled" : "open",
    };
  });
  const previewEmployees: PreviewEmployee[] = employees.map((employee) => ({
    id: employee.id,
    name: employee.full_name,
    level: levels.get(employee.id)?.level ?? 1,
    shifts: previewShiftsByEmployee.get(employee.id) ?? [],
    checklistScores: (checklistsResult.data ?? [])
      .filter((row) => row.employee_id === employee.id)
      .map((row) => ({ storeId: row.store_id, score: Number(row.average_score) })),
    tasks: tasks.filter((task) => task.assigneeEmployeeId === employee.id || !task.assigneeEmployeeId),
    acceptedPackageAmount: isOctoberSimulation ? OCTOBER_PACKAGES[employee.full_name] ?? 0 : 0,
    manualKpiAwardAmount: 0,
    advances: 0,
    deductions: 0,
    signedAdjustments: 0,
  }));

  const [adjustmentsResult, advancesResult, productsResult] = await Promise.all([
    supabase.from("payroll_adjustments").select("employee_id, adjustment_type, amount").eq("period_month", periodStart).returns<AdjustmentRow[]>(),
    supabase.from("employee_advances").select("employee_id, amount").eq("period_month", periodStart).returns<{ employee_id: string; amount: number | string }[]>(),
    supabase.from("payroll_product_writeoffs").select("employee_id, amount").eq("period_month", periodStart).returns<{ employee_id: string; amount: number | string }[]>(),
  ]);
  const [inventoryResult, expirationResult, assignmentsResult, manualKpiResult] = await Promise.all([
    supabase.from("inventory_loss_allocations").select("employee_id, amount, inventory_periods!inner(period_start, period_end)")
      .lte("inventory_periods.period_start", new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10))
      .gte("inventory_periods.period_end", periodStart).returns<InventoryRow[]>(),
    supabase.from("expiration_writeoffs").select("store_id, amount").eq("period_month", periodStart)
      .returns<{ store_id: string; amount: number | string }[]>(),
    supabase.from("employee_store_assignments").select("employee_id, store_id, valid_from, valid_to")
      .eq("is_primary", true).lte("valid_from", new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10))
      .or(`valid_to.is.null,valid_to.gte.${periodStart}`).returns<AssignmentRow[]>(),
    supabase.from("payroll_manual_kpi_awards").select("employee_id, store_id, metric, amount").eq("period_month", periodStart)
      .returns<{ employee_id: string; store_id: string; metric: "average_check" | "check_depth"; amount: number | string }[]>(),
  ]);
  if (adjustmentsResult.error) warnings.push("Удержания/премии не полностью загружены: " + adjustmentsResult.error.message);
  if (advancesResult.error) warnings.push("Авансы не загружены: " + advancesResult.error.message);
  if (productsResult.error) warnings.push("Корректировки под зарплату не загружены: " + productsResult.error.message);
  if (inventoryResult.error) warnings.push("Распределение инвентарных потерь не загружено: " + inventoryResult.error.message);
  if (expirationResult.error || assignmentsResult.error) warnings.push("Удержания по просрочке не удалось распределить по основным магазинам сотрудников.");
  if (manualKpiResult.error) warnings.push("Ручные KPI-корректировки не загружены: " + manualKpiResult.error.message);
  const byEmployee = new Map(previewEmployees.map((employee) => [employee.id, employee]));
  for (const adjustment of adjustmentsResult.data ?? []) {
    const employee = byEmployee.get(adjustment.employee_id);
    if (!employee) continue;
    const amount = Number(adjustment.amount);
    if (["fine", "inventory", "expiration", "product"].includes(adjustment.adjustment_type)) employee.deductions += Math.abs(amount);
    else if (adjustment.adjustment_type === "bonus") employee.signedAdjustments += amount;
  }
  for (const advance of advancesResult.data ?? []) {
    const employee = byEmployee.get(advance.employee_id);
    if (employee) employee.advances += Number(advance.amount);
  }
  for (const product of productsResult.data ?? []) {
    const employee = byEmployee.get(product.employee_id);
    if (employee) employee.deductions += Number(product.amount);
  }
  for (const allocation of inventoryResult.data ?? []) {
    const employee = byEmployee.get(allocation.employee_id);
    if (employee) employee.deductions += Number(allocation.amount);
  }
  const assignmentsByStore = new Map<string, Set<string>>();
  for (const assignment of assignmentsResult.data ?? []) {
    const assigned = assignmentsByStore.get(assignment.store_id) ?? new Set<string>();
    assigned.add(assignment.employee_id);
    assignmentsByStore.set(assignment.store_id, assigned);
  }
  for (const writeoff of expirationResult.data ?? []) {
    const assignedIds = [...(assignmentsByStore.get(writeoff.store_id) ?? [])];
    if (!assignedIds.length) continue;
    const share = Number(writeoff.amount) / assignedIds.length;
    for (const employeeId of assignedIds) {
      const employee = byEmployee.get(employeeId);
      if (employee) employee.deductions += share;
    }
  }
  for (const award of manualKpiResult.data ?? []) {
    const employee = byEmployee.get(award.employee_id);
    const target = plansByStore.get(award.store_id);
    const targetIsMissing = !target || (award.metric === "average_check"
      ? target.average_check_target == null
      : target.check_depth_target == null);
    if (employee && targetIsMissing) employee.manualKpiAwardAmount += Number(award.amount);
  }

  const selectedRates: PreviewRate[] = isOctoberSimulation
    ? [OCTOBER_LEVEL_FOUR]
    : ratesResult.error || !(ratesResult.data?.length)
      ? DEFAULT_RATES
      : DEFAULT_RATES.map((fallback) => {
          const current = (ratesResult.data as RateRow[]).find((row) => row.level === fallback.level);
          return current ? {
            level: current.level,
            hourlyRate: Number(current.hourly_rate),
            baseCommissionPercent: Number(current.base_commission_percent),
            planCommissionPercent: Number(current.plan_commission_percent),
          } : fallback;
        });
  const result = calculateAcademyPayrollPreview(previewEmployees, previewStores, {
    periodMonth: month,
    taskScoring: isOctoberSimulation ? "status" : "on_time",
    hourSource: isOctoberSimulation ? "october_store_schedule" : "confirmed_only",
    rates: selectedRates,
  });
  const displayedEmployees = result.employees.filter((employee) => !isOctoberSimulation || employee.totalShiftCount > 0);
  const grandTotal = displayedEmployees.reduce((sum, employee) => sum + employee.total, 0);
  const missingChecklists = displayedEmployees.filter((employee) => employee.checklistMissing && employee.totalShiftCount >= 3);
  const contestHasConfirmedHours = result.employees.some((employee) => employee.contestBonus > 0);
  if (!contestHasConfirmedHours) warnings.push("Конкурсные выплаты не начислены: в месяце нет подтверждённых личных часов, необходимых для допуска.");

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-5xl">
        <SectionHeader icon={WalletCards} title="Предварительный расчёт Академии" showBack />
        <div className="mt-4 ui-panel border-brand/40 p-4">
          <p className="font-semibold text-brand">Тестовая ведомость · без сохранения</p>
          <p className="mt-1 text-sm text-muted">Расчёт только для проверки формулы. Зарплатная ведомость и выплаты не изменяются.</p>
        </div>
        <form action="/payroll/academy-preview" className="mt-4 flex flex-wrap items-end gap-3" method="get">
          <label className="grid min-w-44 flex-1 gap-1 text-sm">
            <span className="font-semibold">Месяц</span>
            <input className="h-11 rounded-md border border-line px-3" defaultValue={month} name="period" type="month" />
          </label>
          <button className="h-11 rounded-md bg-brand px-4 font-semibold text-white">Пересчитать просмотр</button>
          <Link className="h-11 content-center rounded-md border border-line px-4 text-sm font-semibold" href="/payroll">К ведомости</Link>
        </form>
        {warnings.length ? <section className="mt-4 ui-panel p-4"><h2 className="font-semibold">Требует внимания</h2><ul className="mt-2 grid gap-2 text-sm text-muted">{[...new Set(warnings)].map((warning) => <li key={warning}>{warning}</li>)}</ul></section> : null}
        <section className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="ui-panel p-4"><p className="text-sm text-muted">Предварительно к выплате</p><p className="mt-1 text-xl font-semibold">{money(grandTotal)}</p></div>
          <div className="ui-panel p-4"><p className="text-sm text-muted">Сотрудники</p><p className="mt-1 text-xl font-semibold">{displayedEmployees.length}</p></div>
          <div className="ui-panel p-4"><p className="text-sm text-muted">Без чек-листа</p><p className="mt-1 text-xl font-semibold">{missingChecklists.length}</p></div>
        </section>
        {missingChecklists.length ? <section className="mt-4 ui-panel p-4"><h2 className="font-semibold">Нет чек-листов за месяц</h2><p className="mt-1 text-sm text-muted">По правилу компании премия включена. Список адресатов для месячного уведомления:</p><p className="mt-2 text-sm">{missingChecklists.map((employee) => employee.name).join(", ")}</p><p className="mt-2 text-xs text-muted">Автоматическая отправка уведомления пока не подключена.</p></section> : null}
        {!contestHasConfirmedHours && !isOctoberSimulation ? <p className="mt-4 ui-panel p-3 text-sm text-muted">Конкурсные выплаты не начислены: нужны подтверждённые личные часы и не менее трёх смен в каждом магазине.</p> : null}
        <div className="mt-6 overflow-x-auto rounded-md border border-line">
          <table className="w-full min-w-[1100px] border-collapse text-left text-sm">
            <thead className="bg-panel text-muted"><tr>{["Сотрудник / LVL", "Смены", "Часы", "Почасовая часть", "Комиссия", "Задачи", "Чек-лист", "KPI", "Пакеты", "Авансы и удержания", "Итого"].map((heading) => <th className="px-3 py-3 font-semibold" key={heading}>{heading}</th>)}</tr></thead>
            <tbody>{displayedEmployees.map((employee) => <tr className="border-t border-line" key={employee.employeeId}>
              <td className="px-3 py-3 font-semibold">{employee.name}<span className="block text-xs font-normal text-muted">LVL{employee.level}{employee.checklistMissing ? " · нет чек-листа" : ""}</span></td>
              <td className="px-3 py-3">{employee.totalShiftCount}</td><td className="px-3 py-3">{employee.totalPaidHours}</td>
              <td className="px-3 py-3">{money(employee.hourlyPay)}</td><td className="px-3 py-3">{money(employee.commission)}</td>
              <td className="px-3 py-3">{money(employee.taskBonus)}</td><td className="px-3 py-3">{money(employee.checklistBonus)}</td>
              <td className="px-3 py-3">{money(employee.commercialKpiBonus + employee.contestBonus + employee.manualKpiAwards)}</td>
              <td className="px-3 py-3">{money(employee.acceptedPackages)}</td><td className="px-3 py-3">−{money(employee.advances + employee.deductions)}</td>
              <td className="px-3 py-3 font-semibold">{money(employee.total)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </div>
      <BottomNav />
    </main>
  );
}
