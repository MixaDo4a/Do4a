import { redirect } from "next/navigation";
import { DashboardView, type DashboardData } from "@/components/dashboard-view";
import { getAccessibleStores } from "@/lib/auth/stores";
import { getCurrentRoleCodes, hasAnyRole } from "@/lib/auth/roles";
import { loadAcademyPayLevels } from "@/lib/payroll/academy-level.server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PageProps = { searchParams: Promise<{ period?: string; message?: string; detail?: string }> };
type Relation<T> = T | T[] | null;
type StoreRow = { id: string; name: string; city: string; timezone: string | null; workday_start_time: string | null; workday_end_time: string | null };
type ReportRow = {
  cash_revenue: number | string; card_revenue: number | string; cash_returns: number | string; card_returns: number | string;
  net_revenue: number | string; receipt_count: number; items_sold_count: number | null;
};
type ShiftRow = {
  id: string; store_id: string; shift_date: string; status: string; opened_at: string; closed_at: string | null; is_erroneous: boolean;
  shift_closing_reports: Relation<ReportRow>;
  shift_participants: Array<{
    employee_id: string; participant_role: string;
    employees: Relation<{ id: string; full_name: string; employee_status: string }>;
    shift_work_times: Relation<{ paid_hours: number | string | null; confirmed_at: string | null }>;
  }>;
};
type TaskRow = {
  id: string; store_id: string; assignee_employee_id: string | null; title: string; status: string;
  created_at: string; due_at: string | null; completed_at: string | null;
};
type ChecklistRow = { id: string; store_id: string; employee_id: string; average_score: number | string; submitted_at: string };
type ScheduleRow = { id: string; store_id: string; employee_id: string; shift_date: string; status: string };
type CashRow = { store_id: string; cash_amount: number | string; created_at: string };
type AssignmentRow = {
  employee_id: string; store_id: string; valid_from: string; valid_to: string | null;
  employees: Relation<{ id: string; full_name: string; employee_status: string; is_active: boolean }>;
};
type PayrollRow = {
  employee_id: string; total_payout_amount: number | string; sales_pay_amount: number | string;
  plan_bonus_amount: number | string; base_salary_amount: number | string; manual_bonus_amount: number | string;
  advance_amount: number | string; expiration_writeoff_amount: number | string; inventory_loss_amount: number | string;
  product_writeoff_amount: number | string; calculation_snapshot: Record<string, unknown> | null;
};
type PageResult<T> = { data: T[] | null; error: { message: string } | null };
type StoreDetailRow = StoreRow & { status: string };
type PlanRow = {
  store_id: string; sales_plan_amount: number | string;
  average_check_target: number | string | null; check_depth_target: number | string | null;
};

const PAGE_SIZE = 1000;

function one<T>(value: Relation<T>): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

async function fetchPages<T>(
  build: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}

function validPeriod(period?: string) {
  return period && /^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? period : new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Vladivostok", year: "numeric", month: "2-digit",
  }).format(new Date());
}

function asNumber(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function localDateAt(value: string | null, timeZone: string) {
  if (!value) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const period = validPeriod(params.period);
  const periodStart = `${period}-01`;
  const periodEnd = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const nextMonth = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 1)).toISOString().slice(0, 10);
  const queryStart = new Date(Date.parse(`${periodStart}T00:00:00Z`) - 86_400_000).toISOString();
  const queryEnd = new Date(Date.parse(`${nextMonth}T00:00:00Z`) + 86_400_000).toISOString();
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { roles } = await getCurrentRoleCodes(supabase, user);
  if (!hasAnyRole(roles, ["store_manager", "super_admin", "developer"])) redirect("/");

  const stores = (await getAccessibleStores(supabase)).filter((store) => store.status !== "archived");
  const storeIds = stores.map((store) => store.id);
  if (!storeIds.length) {
    return <DashboardView initialPeriod={period} stores={[]} storeMetrics={[]} employeeMetrics={[]} openShifts={0} message={params.message} detail={params.detail} />;
  }

  const [storeDetailsResult, plansResult, shiftRows, taskRows, checklistRows, scheduleRows, cashRows, assignments, payrollPeriod] = await Promise.all([
    supabase.from("stores").select("id, name, city, timezone, workday_start_time, workday_end_time, status").in("id", storeIds).returns<StoreDetailRow[]>(),
    supabase.from("store_sales_plans").select("store_id, sales_plan_amount, average_check_target, check_depth_target").eq("period_start", periodStart).eq("period_end", periodEnd).in("store_id", storeIds).returns<PlanRow[]>(),
    fetchPages<ShiftRow>((from, to) => supabase.from("shifts")
      .select("id, store_id, shift_date, status, opened_at, closed_at, is_erroneous, shift_closing_reports(cash_revenue, card_revenue, cash_returns, card_returns, net_revenue, receipt_count, items_sold_count), shift_participants(employee_id, participant_role, employees(id, full_name, employee_status), shift_work_times(paid_hours, confirmed_at))")
      .in("store_id", storeIds).gte("shift_date", periodStart).lt("shift_date", nextMonth)
      .order("shift_date").range(from, to).returns<ShiftRow[]>()),
    fetchPages<TaskRow>((from, to) => supabase.from("tasks")
      .select("id, store_id, assignee_employee_id, title, status, created_at, due_at, completed_at")
      .in("store_id", storeIds)
      .or(`and(created_at.gte.${queryStart},created_at.lt.${queryEnd}),and(due_at.gte.${queryStart},due_at.lt.${queryEnd})`)
      .order("created_at").range(from, to).returns<TaskRow[]>()),
    fetchPages<ChecklistRow>((from, to) => supabase.from("checklist_submissions")
      .select("id, store_id, employee_id, average_score, submitted_at")
      .in("store_id", storeIds).eq("period_month", periodStart)
      .order("submitted_at").range(from, to).returns<ChecklistRow[]>()),
    fetchPages<ScheduleRow>((from, to) => supabase.from("schedules")
      .select("id, store_id, employee_id, shift_date, status")
      .in("store_id", storeIds).gte("shift_date", periodStart).lt("shift_date", nextMonth)
      .order("shift_date").range(from, to).returns<ScheduleRow[]>()),
    Promise.all(storeIds.map((storeId) => supabase.from("store_cash_counts").select("store_id, cash_amount, created_at")
      .eq("store_id", storeId).order("created_at", { ascending: false }).limit(1).maybeSingle<CashRow>())),
    fetchPages<AssignmentRow>((from, to) => supabase.from("employee_store_assignments")
      .select("employee_id, store_id, valid_from, valid_to, employees(id, full_name, employee_status, is_active)")
      .in("store_id", storeIds).lte("valid_from", periodEnd)
      .or(`valid_to.is.null,valid_to.gte.${periodStart}`)
      .range(from, to).returns<AssignmentRow[]>()),
    supabase.from("payroll_periods").select("id").eq("period_month", periodStart).maybeSingle<{ id: string }>(),
  ]);

  if (storeDetailsResult.error) throw new Error(storeDetailsResult.error.message);
  if (plansResult.error) throw new Error(plansResult.error.message);
  const cashCountError = cashRows.find((result) => result.error)?.error;
  if (cashCountError) throw new Error(cashCountError.message);
  if (payrollPeriod.error) throw new Error(payrollPeriod.error.message);
  const storeDetails = storeDetailsResult.data ?? [];
  const planByStore = new Map((plansResult.data ?? []).map((plan) => [plan.store_id, plan]));
  const currentOpenQuery = await supabase.from("shifts").select("id", { count: "exact", head: true })
    .in("store_id", storeIds).in("status", ["opened", "correction_required"]);
  if (currentOpenQuery.error) throw new Error(currentOpenQuery.error.message);

  const employeeMap = new Map<string, { id: string; name: string; status: string; stores: Set<string> }>();
  for (const assignment of assignments) {
    const employee = one(assignment.employees);
    if (!employee?.is_active || assignment.valid_from > periodEnd || (assignment.valid_to && assignment.valid_to < periodStart)) continue;
    const value = employeeMap.get(employee.id) ?? { id: employee.id, name: employee.full_name, status: employee.employee_status, stores: new Set<string>() };
    value.stores.add(assignment.store_id);
    employeeMap.set(employee.id, value);
  }
  for (const shift of shiftRows) for (const participant of shift.shift_participants) {
    const person = one(participant.employees);
    if (!person) continue;
    const value = employeeMap.get(person.id) ?? { id: person.id, name: person.full_name, status: person.employee_status, stores: new Set<string>() };
    value.stores.add(shift.store_id);
    employeeMap.set(person.id, value);
  }

  const employeeIds = [...employeeMap.keys()];
  const payrollRows = payrollPeriod.data?.id && employeeIds.length
    ? await fetchPages<PayrollRow>((from, to) => supabase.from("payroll_entries")
      .select("employee_id, total_payout_amount, sales_pay_amount, plan_bonus_amount, base_salary_amount, manual_bonus_amount, advance_amount, expiration_writeoff_amount, inventory_loss_amount, product_writeoff_amount, calculation_snapshot")
      .in("employee_id", employeeIds).eq("payroll_period_id", payrollPeriod.data!.id)
      .range(from, to).returns<PayrollRow[]>())
    : [];
  const canReadAcademyLevel = roles.some((role) => ["super_admin", "developer"].includes(role));
  let levels = new Map<string, { level: number | null }>();
  if (canReadAcademyLevel) {
    try {
      levels = await loadAcademyPayLevels(supabase, employeeIds, periodStart);
    } catch {
      levels = new Map();
    }
  }
  const lastCashByStore = new Map<string, CashRow>();
  for (const result of cashRows) if (result.data) lastCashByStore.set(result.data.store_id, result.data);
  const payrollByEmployee = new Map(payrollRows.map((row) => [row.employee_id, row]));
  const storeById = new Map(storeDetails.map((store) => [store.id, store]));
  const taskAssignmentsByEmployee = new Map<string, TaskRow[]>();
  for (const task of taskRows) {
    if (!task.due_at || task.status === "cancelled") continue;
    const timeZone = storeById.get(task.store_id)?.timezone ?? "Asia/Vladivostok";
    const createdLocalDate = localDateAt(task.created_at, timeZone);
    const dueLocalDate = localDateAt(task.due_at, timeZone);
    if (!dueLocalDate || dueLocalDate < periodStart || dueLocalDate > periodEnd) continue;
    const creditedEmployeeIds = task.assignee_employee_id
      ? [task.assignee_employee_id]
      : [...new Set(shiftRows.filter((shift) => shift.store_id === task.store_id && !shift.is_erroneous && shift.status === "closed" && createdLocalDate && shift.shift_date >= createdLocalDate && shift.shift_date <= dueLocalDate)
        .flatMap((shift) => shift.shift_participants.map((participant) => participant.employee_id)))];
    for (const employeeId of creditedEmployeeIds) {
      const assigned = taskAssignmentsByEmployee.get(employeeId) ?? [];
      assigned.push(task);
      taskAssignmentsByEmployee.set(employeeId, assigned);
    }
  }

  const storeMetrics: DashboardData["storeMetrics"] = storeDetails.map((store) => {
    const rows = shiftRows.filter((shift) => shift.store_id === store.id);
    const validShifts = rows.filter((shift) => !shift.is_erroneous && shift.status === "closed");
    const reports = validShifts.map((shift) => one(shift.shift_closing_reports)).filter((row): row is ReportRow => Boolean(row));
    const net = reports.reduce((sum, row) => sum + asNumber(row.net_revenue), 0);
    const gross = reports.reduce((sum, row) => sum + asNumber(row.cash_revenue) + asNumber(row.card_revenue), 0);
    const returns = reports.reduce((sum, row) => sum + asNumber(row.cash_returns) + asNumber(row.card_returns), 0);
    const receipts = reports.reduce((sum, row) => sum + Number(row.receipt_count || 0), 0);
    const itemCountsKnown = reports.every((row) => row.items_sold_count !== null);
    const items = itemCountsKnown ? reports.reduce((sum, row) => sum + Number(row.items_sold_count ?? 0), 0) : null;
    const storeTasks = taskRows.filter((task) => task.store_id === store.id);
    const dueTasks = storeTasks.filter((task) => {
      const dueLocalDate = localDateAt(task.due_at, store.timezone ?? "Asia/Vladivostok");
      return dueLocalDate && dueLocalDate >= periodStart && dueLocalDate <= periodEnd && task.status !== "cancelled";
    });
    const checks = checklistRows.filter((row) => row.store_id === store.id);
    const plan = planByStore.get(store.id) ?? null;
    const averageCheck = receipts ? net / receipts : null;
    const checkDepth = receipts && items !== null ? items / receipts : null;
    const salesByDay = new Map<string, number>();
    for (const shift of validShifts) {
      const report = one(shift.shift_closing_reports);
      salesByDay.set(shift.shift_date, (salesByDay.get(shift.shift_date) ?? 0) + asNumber(report?.net_revenue));
    }
    const onTimeTasks = dueTasks.filter((task) => task.status === "done" && task.completed_at && task.due_at && new Date(task.completed_at) <= new Date(task.due_at)).length;
    return {
      id: store.id, name: store.name, city: store.city,
      netRevenue: net, grossRevenue: gross, returns, receipts, itemsSold: items, averageCheck,
      checkDepth,
      shiftCount: validShifts.length, erroneousShiftCount: rows.filter((shift) => shift.is_erroneous).length,
      plannedShifts: scheduleRows.filter((row) => row.store_id === store.id && ["planned", "planned_secondary"].includes(row.status)).length,
      salesPlan: plan ? asNumber(plan.sales_plan_amount) : null,
      planCompletion: plan && asNumber(plan.sales_plan_amount) > 0 ? net / asNumber(plan.sales_plan_amount) * 100 : null,
      averageCheckTarget: plan?.average_check_target == null ? null : asNumber(plan.average_check_target),
      checkDepthTarget: plan?.check_depth_target == null ? null : asNumber(plan.check_depth_target),
      averageCheckAchieved: plan?.average_check_target != null && averageCheck !== null && Math.round(averageCheck * 100) / 100 >= asNumber(plan.average_check_target),
      checkDepthAchieved: plan?.check_depth_target != null && checkDepth !== null && Math.round(checkDepth * 100) / 100 >= asNumber(plan.check_depth_target),
      taskOpen: storeTasks.filter((task) => ["open", "in_progress", "overdue"].includes(task.status)).length,
      taskOverdue: dueTasks.filter((task) => task.status === "overdue" || (task.status !== "done" && task.due_at! < new Date().toISOString())).length,
      taskDone: dueTasks.filter((task) => task.status === "done").length,
      taskOnTime: onTimeTasks,
      taskDueCount: dueTasks.length,
      checklistCount: checks.length,
      checklistScoreTotal: checks.reduce((sum, row) => sum + asNumber(row.average_score), 0),
      checklistAverage: checks.length ? checks.reduce((sum, row) => sum + asNumber(row.average_score), 0) / checks.length : null,
      employeeCount: new Set(validShifts.flatMap((shift) => shift.shift_participants.map((person) => person.employee_id))).size,
      cashAmount: lastCashByStore.has(store.id) ? asNumber(lastCashByStore.get(store.id)!.cash_amount) : null,
      cashUpdatedAt: lastCashByStore.get(store.id)?.created_at ?? null,
      dailySales: [...salesByDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => ({ date, amount })),
    };
  });

  const employeeMetrics: DashboardData["employeeMetrics"] = [...employeeMap.values()].map((employee) => {
    const participations = shiftRows.flatMap((shift) => {
      const participant = shift.shift_participants.find((person) => person.employee_id === employee.id);
      if (!participant || shift.is_erroneous || shift.status !== "closed") return [];
      const report = one(shift.shift_closing_reports);
      if (!report) return [];
      const time = one(participant.shift_work_times);
      return [{ shift, participant, report, hours: time?.confirmed_at ? asNumber(time.paid_hours) : null }];
    });
    const assignedTasks = taskAssignmentsByEmployee.get(employee.id) ?? [];
    const checks = checklistRows.filter((row) => row.employee_id === employee.id);
    const checkedHours = participations.reduce((sum, row) => sum + (row.hours ?? 0), 0);
    const itemsKnown = participations.every(({ report }) => report.items_sold_count !== null);
    const receipts = participations.reduce((sum, row) => sum + row.report.receipt_count, 0);
    const net = participations.reduce((sum, row) => sum + asNumber(row.report.net_revenue), 0);
    const payrollEntry = payrollByEmployee.get(employee.id);
    const academySnapshot = payrollEntry?.calculation_snapshot?.academy_payroll;
    const academyBreakdown = academySnapshot && typeof academySnapshot === "object" ? academySnapshot as Record<string, unknown> : null;
    return {
      id: employee.id, name: employee.name, status: employee.status, level: levels.get(employee.id)?.level ?? null,
      storeIds: [...employee.stores],
      stores: [...employee.stores].map((id) => storeById.get(id)?.name ?? "").filter(Boolean),
      shiftCount: new Set(participations.map((row) => row.shift.id)).size,
      confirmedHours: checkedHours, unconfirmedShifts: participations.filter((row) => row.hours === null).length,
      participationRevenue: net,
      grossParticipationRevenue: participations.reduce((sum, row) => sum + asNumber(row.report.cash_revenue) + asNumber(row.report.card_revenue), 0),
      returns: participations.reduce((sum, row) => sum + asNumber(row.report.cash_returns) + asNumber(row.report.card_returns), 0),
      receipts,
      itemsSold: itemsKnown ? participations.reduce((sum, row) => sum + Number(row.report.items_sold_count ?? 0), 0) : null,
      averageCheck: receipts ? net / receipts : null,
      taskDueCount: assignedTasks.length, taskDone: assignedTasks.filter((task) => task.status === "done").length,
      taskOnTime: assignedTasks.filter((task) => task.status === "done" && task.completed_at && new Date(task.completed_at) <= new Date(task.due_at!)).length,
      checklistCount: checks.length,
      checklistAverage: checks.length ? checks.reduce((sum, row) => sum + asNumber(row.average_score), 0) / checks.length : null,
      payroll: payrollEntry ? asNumber(payrollEntry.total_payout_amount) : null,
      payrollParts: payrollEntry ? {
        mode: academyBreakdown ? "academy" as const : "legacy" as const,
        sales: asNumber(payrollEntry.sales_pay_amount), base: asNumber(payrollEntry.base_salary_amount),
        bonus: asNumber(payrollEntry.plan_bonus_amount) + asNumber(payrollEntry.manual_bonus_amount),
        advances: asNumber(payrollEntry.advance_amount), deductions: asNumber(payrollEntry.expiration_writeoff_amount) + asNumber(payrollEntry.inventory_loss_amount) + asNumber(payrollEntry.product_writeoff_amount),
        hourly: asNumber(academyBreakdown?.hourlyPay as number | string | null),
        commission: asNumber(academyBreakdown?.commission as number | string | null),
        taskBonus: asNumber(academyBreakdown?.taskBonus as number | string | null),
        checklistBonus: asNumber(academyBreakdown?.checklistBonus as number | string | null),
        commercialKpiBonus: asNumber(academyBreakdown?.commercialKpiBonus as number | string | null),
        contestBonus: asNumber(academyBreakdown?.contestBonus as number | string | null),
        networkPackage: asNumber(academyBreakdown?.networkPackage as number | string | null),
        mentorshipPackage: asNumber(academyBreakdown?.mentorshipPackage as number | string | null),
        paidHours: asNumber(academyBreakdown?.paidHours as number | string | null),
      } : null,
    };
  }).sort((a, b) => b.participationRevenue - a.participationRevenue);

  const dailySales = new Map<string, number>();
  for (const metric of storeMetrics) for (const day of metric.dailySales) {
    dailySales.set(day.date, (dailySales.get(day.date) ?? 0) + day.amount);
  }
  const openShifts = currentOpenQuery.count ?? 0;
  return <DashboardView
    initialPeriod={period}
    stores={stores.map(({ id, name, city }) => ({ id, name, city }))}
    storeMetrics={storeMetrics}
    employeeMetrics={employeeMetrics}
    openShifts={openShifts}
    message={params.message}
    detail={params.detail}
  />;
}
