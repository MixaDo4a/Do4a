import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_TIME_ZONE } from "@/lib/timezone";
import { loadAcademyPayLevels } from "@/lib/payroll/academy-level.server";
import {
  calculateAcademyPayrollPreview,
  type PreviewEmployee,
  type PreviewRate,
  type PreviewShift,
  type PreviewStore,
  type PreviewTask,
} from "@/lib/payroll/academy-payroll-preview";
import { resolveCityPayrollMode } from "@/lib/payroll/city-payroll-mode";
import { isRetailStoreForMotivation } from "@/lib/store-motivation";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

type Relation<T> = T | T[] | null;
type EmployeeRow = { id: string; full_name: string; employee_status: string; is_active: boolean };
type StoreRow = {
  id: string; name: string; city: string | null; timezone: string | null;
  workday_start_time: string | null; workday_end_time: string | null;
};
type ReportRow = {
  gross_revenue: number | string | null; net_revenue: number | string | null;
  cash_returns: number | string | null; card_returns: number | string | null;
  receipt_count: number | null; items_sold_count: number | null;
};
type WorkTimeRow = { paid_hours: number | string | null; confirmed_at: string | null };
type ParticipantRow = {
  id: string; employee_id: string; participant_role: "primary_seller" | "secondary_seller";
  shift_work_times: Relation<WorkTimeRow>;
};
type ShiftRow = {
  id: string; store_id: string; shift_date: string; status: string; is_erroneous: boolean;
  stores: Relation<StoreRow>; shift_closing_reports: Relation<ReportRow>; shift_participants: ParticipantRow[];
};
type TaskRow = {
  id: string; store_id: string | null; assignee_employee_id: string | null;
  created_at: string; due_at: string | null; completed_at: string | null; status: string;
  stores: Relation<Pick<StoreRow, "timezone" | "city">>;
};
type MetricRow = {
  employee_id: string; shift_id: string; store_id: string;
  gross_revenue: number | string; sales_pay_amount: number | string;
  receipt_count: number; items_sold_count: number | null;
};
type RateRow = {
  id: number; level: number; hourly_rate: number | string;
  base_commission_percent: number | string; plan_commission_percent: number | string;
};
type PlanRow = {
  store_id: string; sales_plan_amount: number | string;
  average_check_target: number | string | null; check_depth_target: number | string | null;
};
type ChecklistRow = { employee_id: string; store_id: string; average_score: number | string };
type EntryRow = {
  id: string; employee_id: string; shift_count: number | string; gross_revenue: number | string;
  sales_pay_amount: number | string; plan_bonus_amount: number | string;
  checklist_salary_per_shift: number | string; base_salary_amount: number | string;
  manual_bonus_amount: number | string;
  advance_amount: number | string; expiration_writeoff_amount: number | string;
  inventory_loss_amount: number | string; product_writeoff_amount: number | string;
  calculation_snapshot: Record<string, unknown> | null;
};
type ModeRow = { city: string; effective_from: string; calculation_mode: "legacy" | "academy"; created_at: string };
type PaidPackageRow = { employee_id: string; amount: number | string; package_type: "mentorship" };

function one<T>(value: Relation<T>): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function amount(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function localDate(value: string | null, timeZone: string): string | null {
  if (!value) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function workdayHours(store: StoreRow): number {
  if (!store.workday_start_time || !store.workday_end_time) return 0;
  const minutes = (value: string) => {
    const [hour, minute] = value.split(":").map(Number);
    return hour * 60 + minute;
  };
  let duration = minutes(store.workday_end_time) - minutes(store.workday_start_time);
  if (duration < 0) duration += 24 * 60;
  return duration / 60;
}

async function fetchPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const result: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await fetchPage(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    result.push(...rows);
    if (rows.length < 1000) return result;
  }
}

function shiftIsCountedByLegacyFormula(shift: ShiftRow, metric: MetricRow): boolean {
  const report = one(shift.shift_closing_reports);
  return amount(metric.gross_revenue) > 0
    || metric.receipt_count > 0
    || amount(metric.items_sold_count) > 0
    || amount(report?.cash_returns) > 0
    || amount(report?.card_returns) > 0;
}

function networkStoreName(name: string): boolean {
  const normalized = name.trim().toLocaleLowerCase("ru-RU");
  return normalized === "urban" || normalized === "урбан" || normalized === "наутилус" || normalized === "nautilus";
}

export async function applyAcademyPayrollToCalculatedRows(
  actorClient: SupabaseClient,
  periodMonth: string,
  employeeIds?: string[],
): Promise<void> {
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(periodMonth)) throw new Error("Payroll month must be the first day of a month");
  const db = createSupabaseServiceRoleClient();

  const [{ data: period, error: periodError }, { data: employees, error: employeesError }, { data: stores, error: storesError }, { data: modes, error: modesError }] = await Promise.all([
    db.from("payroll_periods").select("id").eq("period_month", periodMonth).maybeSingle<{ id: string }>(),
    db.from("employees").select("id, full_name, employee_status, is_active").order("full_name").returns<EmployeeRow[]>(),
    db.from("stores").select("id, name, city, timezone, workday_start_time, workday_end_time").returns<StoreRow[]>(),
    db.from("city_payroll_modes").select("city, effective_from, calculation_mode, created_at").lte("effective_from", periodMonth).order("effective_from", { ascending: false }).order("created_at", { ascending: false }).returns<ModeRow[]>(),
  ]);
  for (const error of [periodError, employeesError, storesError, modesError]) if (error) throw new Error(error.message);
  if (!period?.id) throw new Error("Payroll period was not created before Academy calculation");

  const activeEmployees = employees ?? [];
  const allEmployeeIds = activeEmployees.map((employee) => employee.id);
  const storeRows = stores ?? [];
  const storeById = new Map(storeRows.map((store) => [store.id, store]));
  const modeRows = modes ?? [];
  const academyStores = storeRows.filter((store) => isRetailStoreForMotivation(store.name)
    && store.city && resolveCityPayrollMode(modeRows, store.city, periodMonth.slice(0, 7)) === "academy");
  const academyStoreIds = new Set(academyStores.map((store) => store.id));

  const monthEnd = new Date(Date.UTC(Number(periodMonth.slice(0, 4)), Number(periodMonth.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const nextMonth = new Date(Date.UTC(Number(periodMonth.slice(0, 4)), Number(periodMonth.slice(5, 7)), 1)).toISOString().slice(0, 10);
  const monthShiftRows = await fetchPages<ShiftRow>((from, to) => db.from("shifts")
    .select("id, store_id, shift_date, status, is_erroneous, stores(id, name, city, timezone, workday_start_time, workday_end_time), shift_closing_reports(gross_revenue, net_revenue, cash_returns, card_returns, receipt_count, items_sold_count), shift_participants(id, employee_id, participant_role, shift_work_times(paid_hours, confirmed_at))")
    .in("status", ["closed", "auto_closed"]).gte("shift_date", periodMonth).lt("shift_date", nextMonth)
    .order("shift_date").range(from, to).returns<ShiftRow[]>());
  const shiftsById = new Map(monthShiftRows.map((shift) => [shift.id, shift]));
  const validMonthShifts = monthShiftRows.filter((shift) => !shift.is_erroneous);

  const monthTasksRaw = await fetchPages<TaskRow>((from, to) => db.from("tasks")
    .select("id, store_id, assignee_employee_id, created_at, due_at, completed_at, status, stores(timezone, city)")
    .gte("due_at", new Date(Date.parse(`${periodMonth}T00:00:00Z`) - 86_400_000).toISOString())
    .lt("due_at", new Date(Date.parse(`${nextMonth}T00:00:00Z`) + 86_400_000).toISOString())
    .order("due_at").range(from, to).returns<TaskRow[]>());
  const taskRows = monthTasksRaw.filter((task) => task.store_id === null || academyStoreIds.has(task.store_id));
  const taskDates = taskRows.map((task) => {
    const timeZone = (task.store_id ? storeById.get(task.store_id)?.timezone : null) ?? one(task.stores)?.timezone ?? DEFAULT_TIME_ZONE;
    return { task, timeZone, created: localDate(task.created_at, timeZone), due: localDate(task.due_at, timeZone) };
  }).filter((item) => item.due?.slice(0, 7) === periodMonth.slice(0, 7));

  const historyStart = taskDates.reduce<string | null>((start, item) => !item.task.assignee_employee_id && item.task.store_id && item.created
    ? start === null || item.created < start ? item.created : start
    : start, null);
  const historicalShifts = historyStart
    ? await fetchPages<Pick<ShiftRow, "id" | "store_id" | "shift_date" | "is_erroneous" | "shift_participants">>((from, to) => db.from("shifts")
      .select("id, store_id, shift_date, is_erroneous, shift_participants(employee_id)")
      .in("status", ["closed", "auto_closed"]).gte("shift_date", historyStart).lt("shift_date", nextMonth)
      .order("shift_date").range(from, to).returns<Pick<ShiftRow, "id" | "store_id" | "shift_date" | "is_erroneous" | "shift_participants">[]>())
    : [];

  const [checklists, rateRows, planRows, metrics, entries, paidPackages] = await Promise.all([
    fetchPages<ChecklistRow>((from, to) => db.from("checklist_submissions").select("employee_id, store_id, average_score")
      .eq("period_month", periodMonth).order("submitted_at").range(from, to).returns<ChecklistRow[]>()),
    db.from("academy_pay_rates").select("id, level, hourly_rate, base_commission_percent, plan_commission_percent")
      .lte("effective_from", periodMonth).order("effective_from", { ascending: false }).order("id", { ascending: false }).returns<RateRow[]>(),
    db.from("store_sales_plans").select("store_id, sales_plan_amount, average_check_target, check_depth_target")
      .eq("period_start", periodMonth).eq("period_end", monthEnd).returns<PlanRow[]>(),
    fetchPages<MetricRow>((from, to) => db.from("sales_metrics").select("employee_id, shift_id, store_id, gross_revenue, sales_pay_amount, receipt_count, items_sold_count")
      .eq("period_month", periodMonth).order("shift_id").range(from, to).returns<MetricRow[]>()),
    fetchPages<EntryRow>((from, to) => db.from("payroll_entries").select("id, employee_id, shift_count, gross_revenue, sales_pay_amount, plan_bonus_amount, checklist_salary_per_shift, manual_bonus_amount, advance_amount, expiration_writeoff_amount, inventory_loss_amount, product_writeoff_amount, calculation_snapshot")
      .eq("payroll_period_id", period.id).order("employee_id").range(from, to).returns<EntryRow[]>()),
    db.from("academy_payroll_packages").select("employee_id, amount, package_type")
      .eq("period_month", periodMonth).eq("status", "confirmed").returns<PaidPackageRow[]>(),
  ]);
  for (const result of [rateRows, planRows]) if (result.error) throw new Error(result.error.message);
  if (metrics.length === 0 && monthShiftRows.length > 0) throw new Error("Sales metrics are required to reconcile the legacy payroll baseline");
  const ratesByLevel = new Map<number, PreviewRate>();
  for (const row of rateRows.data ?? []) if (!ratesByLevel.has(row.level)) ratesByLevel.set(row.level, {
    level: row.level,
    hourlyRate: amount(row.hourly_rate),
    baseCommissionPercent: amount(row.base_commission_percent),
    planCommissionPercent: amount(row.plan_commission_percent),
  });
  const rates = [...ratesByLevel.values()];
  const levels = await loadAcademyPayLevels(db as never, allEmployeeIds, periodMonth);

  const planByStore = new Map((planRows.data ?? []).map((plan) => [plan.store_id, plan]));
  const storeReports = new Map<string, Map<string, ReportRow>>();
  for (const shift of validMonthShifts) {
    const report = one(shift.shift_closing_reports);
    if (!report || !academyStoreIds.has(shift.store_id)) continue;
    const perStore = storeReports.get(shift.store_id) ?? new Map<string, ReportRow>();
    perStore.set(shift.id, report);
    storeReports.set(shift.store_id, perStore);
  }
  const previewStores: PreviewStore[] = academyStores.map((store) => {
    const reports = [...(storeReports.get(store.id)?.values() ?? [])];
    const itemsUnknown = reports.some((report) => report.items_sold_count === null);
    const totalReceipts = reports.reduce((sum, report) => sum + (report.receipt_count ?? 0), 0);
    const plan = planByStore.get(store.id);
    return {
      id: store.id,
      workdayHours: workdayHours(store),
      netRevenue: reports.reduce((sum, report) => sum + amount(report.net_revenue), 0),
      receiptCount: totalReceipts,
      itemsSoldCount: itemsUnknown ? null : reports.reduce((sum, report) => sum + (report.items_sold_count ?? 0), 0),
      averageCheckTarget: plan?.average_check_target == null ? null : amount(plan.average_check_target),
      checkDepthTarget: plan?.check_depth_target == null ? null : amount(plan.check_depth_target),
      salesPlanAmount: plan ? amount(plan.sales_plan_amount) : null,
    };
  });

  const academyShiftsByEmployee = new Map<string, PreviewShift[]>();
  const confirmedShiftIdsByEmployee = new Map<string, Set<string>>();
  const totalMonthShiftsByEmployee = new Map<string, Set<string>>();
  for (const shift of validMonthShifts) {
    if (!academyStoreIds.has(shift.store_id)) continue;
    for (const participant of shift.shift_participants ?? []) {
      const workTime = one(participant.shift_work_times);
      const hasConfirmedHours = Boolean(workTime?.confirmed_at && workTime.paid_hours !== null);
      const monthShiftIds = totalMonthShiftsByEmployee.get(participant.employee_id) ?? new Set<string>();
      monthShiftIds.add(shift.id);
      totalMonthShiftsByEmployee.set(participant.employee_id, monthShiftIds);
      if (hasConfirmedHours) {
        const confirmedIds = confirmedShiftIdsByEmployee.get(participant.employee_id) ?? new Set<string>();
        confirmedIds.add(shift.id);
        confirmedShiftIdsByEmployee.set(participant.employee_id, confirmedIds);
      }
      const report = one(shift.shift_closing_reports);
      const rows = academyShiftsByEmployee.get(participant.employee_id) ?? [];
      rows.push({
        id: shift.id,
        storeId: shift.store_id,
        shiftDate: shift.shift_date,
        paidHours: amount(workTime?.paid_hours),
        confirmedHours: hasConfirmedHours,
        participantRole: participant.participant_role,
        netRevenue: amount(report?.net_revenue),
        receiptCount: report?.receipt_count ?? 0,
        itemsSoldCount: report?.items_sold_count ?? null,
      });
      academyShiftsByEmployee.set(participant.employee_id, rows);
    }
  }

  const academyTasks: PreviewTask[] = taskDates.flatMap(({ task, created, due }) => {
    if (!due || !created || task.status === "cancelled") return [];
    const eligibleEmployeeIds = task.assignee_employee_id
      ? undefined
      : historicalShifts.filter((shift) => shift.store_id === task.store_id && !shift.is_erroneous
          && shift.shift_date >= created && shift.shift_date <= due)
        .flatMap((shift) => shift.shift_participants.map((participant) => participant.employee_id));
    return [{
      id: task.id,
      storeId: task.store_id ?? "",
      assigneeEmployeeId: task.assignee_employee_id,
      createdLocalDate: created,
      dueLocalDate: due,
      dueAt: task.due_at,
      completedAt: task.completed_at,
      status: task.status === "done" ? "done" : task.status === "cancelled" ? "cancelled" : "open",
      eligibleEmployeeIds,
    }];
  });

  const networkStoreIds = new Set(academyStores.filter((store) => networkStoreName(store.name)).map((store) => store.id));
  const networkEligible = new Map<string, { shifts: Set<string>; hours: number }>();
  for (const [employeeId, shifts] of academyShiftsByEmployee) {
    const eligibleShifts = shifts.filter((shift) => networkStoreIds.has(shift.storeId) && shift.confirmedHours);
    const ids = new Set(eligibleShifts.map((shift) => shift.id));
    const hours = eligibleShifts.reduce((sum, shift) => sum + shift.paidHours, 0);
    if (ids.size > 3 && hours > 0) networkEligible.set(employeeId, { shifts: ids, hours });
  }
  const networkTotalHours = [...networkEligible.values()].reduce((sum, row) => sum + row.hours, 0);
  const networkShareByEmployee = new Map([...networkEligible].map(([employeeId, row]) => [employeeId, networkTotalHours > 0 ? 10_000 * row.hours / networkTotalHours : 0]));
  const mentorshipByEmployee = new Map<string, number>();
  for (const row of paidPackages.data ?? []) {
    if (row.package_type === "mentorship") mentorshipByEmployee.set(row.employee_id, (mentorshipByEmployee.get(row.employee_id) ?? 0) + amount(row.amount));
  }

  const checklistByEmployee = new Map<string, ChecklistRow[]>();
  for (const row of checklists ?? []) {
    if (!academyStoreIds.has(row.store_id)) continue;
    const list = checklistByEmployee.get(row.employee_id) ?? [];
    list.push(row);
    checklistByEmployee.set(row.employee_id, list);
  }
  const employeeById = new Map(activeEmployees.map((employee) => [employee.id, employee]));
  const previewEmployees: PreviewEmployee[] = activeEmployees.map((employee) => {
    const academyShifts = academyShiftsByEmployee.get(employee.id) ?? [];
    const payLevel = levels.get(employee.id);
    if (!payLevel || payLevel.status === "ambiguous" || payLevel.level === null) {
      throw new Error(`Academy pay level is ambiguous for ${employee.full_name}; resolve rank history before payroll calculation`);
    }
    const level = payLevel.level;
    const packageAmount = academyShifts.length > 0
      ? (level >= 7 ? mentorshipByEmployee.get(employee.id) ?? 0 : 0) + (networkShareByEmployee.get(employee.id) ?? 0)
      : 0;
    return {
      id: employee.id,
      name: employee.full_name,
      level,
      shifts: academyShifts,
      checklistScores: (checklistByEmployee.get(employee.id) ?? []).map((row) => ({ storeId: row.store_id, score: amount(row.average_score) })),
      tasks: academyTasks.filter((task) => task.assigneeEmployeeId === employee.id || !task.assigneeEmployeeId),
      acceptedPackageAmount: packageAmount,
      advances: 0,
      deductions: 0,
      signedAdjustments: 0,
      eligibilityShiftCount: confirmedShiftIdsByEmployee.get(employee.id)?.size ?? 0,
    };
  });
  const preview = academyStoreIds.size && rates.length
    ? calculateAcademyPayrollPreview(previewEmployees, previewStores, {
        periodMonth: periodMonth.slice(0, 7), taskScoring: "on_time", hourSource: "confirmed_only", rates,
      })
    : null;
  if (academyStoreIds.size && !rates.length) throw new Error(`No Academy rates are configured for ${periodMonth}`);
  const academyPreviewByEmployee = new Map((preview?.employees ?? []).map((row) => [row.employeeId, row]));

  const validShiftIds = new Set(validMonthShifts.map((shift) => shift.id));
  const validMetrics = metrics.filter((metric) => validShiftIds.has(metric.shift_id));
  const metricsByEmployeeStore = new Map<string, MetricRow[]>();
  for (const metric of validMetrics) {
    const store = storeById.get(metric.store_id);
    if (!store || !isRetailStoreForMotivation(store.name) || !store.city
      || resolveCityPayrollMode(modeRows ?? [], store.city, periodMonth.slice(0, 7)) !== "legacy") continue;
    const key = `${metric.employee_id}:${metric.store_id}`;
    const rows = metricsByEmployeeStore.get(key) ?? [];
    rows.push(metric);
    metricsByEmployeeStore.set(key, rows);
  }
  const legacyStoreGross = new Map<string, number>();
  for (const shift of validMonthShifts) {
    const store = storeById.get(shift.store_id);
    if (!store || !isRetailStoreForMotivation(store.name) || !store.city
      || resolveCityPayrollMode(modeRows ?? [], store.city, periodMonth.slice(0, 7)) !== "legacy") continue;
    const report = one(shift.shift_closing_reports);
    legacyStoreGross.set(store.id, (legacyStoreGross.get(store.id) ?? 0) + amount(report?.gross_revenue));
  }

  const entryByEmployee = new Map((entries ?? []).map((entry) => [entry.employee_id, entry]));
  const targetIds = employeeIds ? new Set(employeeIds) : new Set(allEmployeeIds);
  for (const employeeId of targetIds) {
    const entry = entryByEmployee.get(employeeId);
    const employee = employeeById.get(employeeId);
    if (!entry || !employee) continue;
    const legacyMetrics = validMetrics.filter((metric) => metric.employee_id === employeeId && metricsByEmployeeStore.has(`${employeeId}:${metric.store_id}`));
    const legacySales = legacyMetrics.reduce((sum, metric) => sum + amount(metric.sales_pay_amount), 0);
    const legacyGrossRevenue = legacyMetrics.reduce((sum, metric) => sum + amount(metric.gross_revenue), 0);
    const legacyCountedShiftIds = new Set(legacyMetrics.filter((metric) => {
      const shift = shiftsById.get(metric.shift_id);
      return shift ? shiftIsCountedByLegacyFormula(shift, metric) : false;
    }).map((metric) => metric.shift_id));
    let legacyPlanBonus = 0;
    for (const store of storeRows) {
      if (!isRetailStoreForMotivation(store.name) || !store.city
        || resolveCityPayrollMode(modeRows ?? [], store.city, periodMonth.slice(0, 7)) !== "legacy") continue;
      const storePlan = planByStore.get(store.id);
      if (!storePlan || (legacyStoreGross.get(store.id) ?? 0) < amount(storePlan.sales_plan_amount)) continue;
      const employeeStoreGross = legacyMetrics.filter((metric) => metric.store_id === store.id)
        .reduce((sum, metric) => sum + amount(metric.gross_revenue), 0);
      legacyPlanBonus += employeeStoreGross * 0.01;
    }

    const academyResult = academyPreviewByEmployee.get(employeeId);
    const hasAcademyShift = (academyShiftsByEmployee.get(employeeId)?.length ?? 0) > 0;
    const academyRows = academyShiftsByEmployee.get(employeeId) ?? [];
    const academyGrossRevenue = validMetrics
      .filter((metric) => metric.employee_id === employeeId && academyStoreIds.has(metric.store_id))
      .reduce((sum, metric) => sum + amount(metric.gross_revenue), 0);
    const totalGrossRevenue = legacyGrossRevenue + academyGrossRevenue;
    const legacyShiftCount = legacyCountedShiftIds.size;
    const academyShiftCount = academyRows.length;
    const academyPay = hasAcademyShift ? academyResult?.hourlyPay ?? 0 : 0;
    const academyCommission = hasAcademyShift ? academyResult?.commission ?? 0 : 0;
    const academyAwards = hasAcademyShift
      ? (academyResult?.taskBonus ?? 0) + (academyResult?.checklistBonus ?? 0)
        + (academyResult?.commercialKpiBonus ?? 0) + (academyResult?.contestBonus ?? 0)
        + (academyResult?.acceptedPackages ?? 0)
      : 0;
    const salaryPerLegacyShift = amount(entry.checklist_salary_per_shift);
    const legacyBase = roundMoney(legacyShiftCount * salaryPerLegacyShift);
    const baseSalary = roundMoney(legacyBase + academyPay);
    const salesPay = roundMoney(legacySales + academyCommission);
    const planBonus = roundMoney(legacyPlanBonus + academyAwards);
    const shiftCount = legacyShiftCount + academyShiftCount;
    const total = roundMoney(salesPay + planBonus + baseSalary + amount(entry.manual_bonus_amount)
      - amount(entry.advance_amount) - amount(entry.expiration_writeoff_amount)
      - amount(entry.inventory_loss_amount) - amount(entry.product_writeoff_amount));
    const academyBreakdown = hasAcademyShift && academyResult ? {
      level: academyResult.level,
      confirmedShiftCount: academyResult.totalShiftCount,
      eligibilityShiftCount: confirmedShiftIdsByEmployee.get(employeeId)?.size ?? 0,
      paidHours: academyResult.totalPaidHours,
      hourlyPay: academyResult.hourlyPay,
      commission: academyResult.commission,
      taskBonus: academyResult.taskBonus,
      taskCompletionPercent: academyResult.taskCompletionPercent,
      eligibleTaskCount: academyResult.eligibleTaskCount,
      checklistBonus: academyResult.checklistBonus,
      checklistMissing: academyResult.checklistMissing,
      checklistQualityByStore: academyResult.checklistQualityByStore,
      commercialKpiBonus: academyResult.commercialKpiBonus,
      contestBonus: academyResult.contestBonus,
      networkPackage: networkShareByEmployee.get(employeeId) ?? 0,
      mentorshipPackage: academyResult.acceptedPackages - (networkShareByEmployee.get(employeeId) ?? 0),
      shiftPayByStore: academyResult.shiftPayByStore,
      commissionByStore: academyResult.commissionByStore,
      commissionByShift: academyResult.commissionByShift,
    } : null;
    const nextSnapshot = {
      ...(entry.calculation_snapshot ?? {}),
      calculation_mode: hasAcademyShift ? "mixed_by_city" : "legacy",
      legacy_city_payroll: { grossRevenue: roundMoney(legacyGrossRevenue), salesPay: roundMoney(legacySales), shiftCount: legacyShiftCount, planBonus: roundMoney(legacyPlanBonus) },
      academy_payroll: academyBreakdown,
    };

    const valuesEqual = amount(entry.gross_revenue) === roundMoney(totalGrossRevenue)
      && amount(entry.sales_pay_amount) === salesPay
      && amount(entry.plan_bonus_amount) === planBonus
      && amount(entry.base_salary_amount) === baseSalary
      && amount(entry.shift_count) === shiftCount
      && JSON.stringify(entry.calculation_snapshot ?? {}) === JSON.stringify(nextSnapshot);
    if (valuesEqual) continue;
    const { error } = await db.from("payroll_entries").update({
      shift_count: shiftCount,
      gross_revenue: roundMoney(totalGrossRevenue),
      sales_pay_amount: salesPay,
      plan_bonus_amount: planBonus,
      base_salary_amount: baseSalary,
      total_payout_amount: total,
      calculation_snapshot: nextSnapshot,
    }).eq("id", entry.id);
    if (error) throw new Error(`Failed to apply Academy payroll for ${employee.full_name}: ${error.message}`);
  }

  if (academyStoreIds.size) {
    const { error } = await db.rpc("notify_missing_academy_checklists", { p_period_month: periodMonth });
    if (error) console.error("Failed to notify managers about missing monthly checklists", error.message);
  }

  void actorClient;
}
