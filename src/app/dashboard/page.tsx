import { redirect } from "next/navigation";
import { DashboardView, type DashboardData, type StoreMonthlyMetric } from "@/components/dashboard-view";
import { getAccessibleStores } from "@/lib/auth/stores";
import { getCurrentRoleCodes, hasAnyRole } from "@/lib/auth/roles";
import { loadAcademyPayLevels } from "@/lib/payroll/academy-level.server";
import { forecastStorePlan } from "@/lib/store-plan-forecast";
import { isRetailStoreForMotivation } from "@/lib/store-motivation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PageProps = { searchParams: Promise<{
  period?: string; overviewPeriod?: string; employeesPeriod?: string; storesPeriod?: string; goalsPeriod?: string;
  mainTab?: string; tab?: string; message?: string; detail?: string;
}> };
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
    employees: Relation<{ id: string; full_name: string }>;
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
  employees: Relation<{ id: string; full_name: string; is_active: boolean }>;
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
  is_auto_generated: boolean;
};
type HistoricalMonthRow = {
  store_id: string; period_start: string; revenue_amount: number | string; returns_amount: number | string;
  receipt_count: number; items_sold_count: number | null; active_days: number;
  missing_revenue_days: number; missing_receipt_days: number; missing_item_days: number;
  seasonality_coefficient: number | string | null;
};
type HistoricalDayRow = {
  store_id: string; sales_date: string; revenue_amount: number | string; returns_amount: number | string;
  receipt_count: number; items_sold_count: number; nonzero_turnover_shifts: number;
};
type MonthlyReportRow = {
  gross_revenue: number | string | null; cash_revenue: number | string | null; card_revenue: number | string | null;
  cash_returns: number | string | null; card_returns: number | string | null; receipt_count: number | null; items_sold_count: number | null;
};
type MonthlyShiftRow = {
  store_id: string; shift_date: string; status: string; is_erroneous: boolean;
  shift_closing_reports: Relation<MonthlyReportRow>;
};
type YearPlanRow = { store_id: string; period_start: string; sales_plan_amount: number | string };

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

function addMonths(period: string, amount: number) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + amount, 1)).toISOString().slice(0, 7);
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
  const fallbackPeriod = validPeriod(params.period);
  const currentMonth = validPeriod();
  const periods = {
    overview: validPeriod(params.overviewPeriod ?? fallbackPeriod),
    employees: validPeriod(params.employeesPeriod ?? fallbackPeriod),
    stores: validPeriod(params.storesPeriod ?? fallbackPeriod),
    goals: validPeriod(params.goalsPeriod ?? addMonths(currentMonth, 1)),
  };
  const mainTab = params.mainTab === "stores" ? "stores" : "overview";
  const storeTab = params.tab === "stores" || params.tab === "goals" ? params.tab : "employees";
  const period = mainTab === "overview" ? periods.overview : periods[storeTab];
  const periodStart = `${period}-01`;
  const periodEnd = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const nextMonth = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 1)).toISOString().slice(0, 10);
  const queryStart = new Date(Date.parse(`${periodStart}T00:00:00Z`) - 86_400_000).toISOString();
  const queryEnd = new Date(Date.parse(`${nextMonth}T00:00:00Z`) + 86_400_000).toISOString();
  const currentYear = Number(currentMonth.slice(0, 4));
  const yearStart = `${Math.min(Number(period.slice(0, 4)) - 1, currentYear - 1)}-01-01`;
  const nextYear = `${Math.max(Number(period.slice(0, 4)) + 1, currentYear + 1)}-01-01`;
  const nextPlanPeriod = addMonths(currentMonth, 1);
  const nextPlanStart = `${nextPlanPeriod}-01`;
  const nextPlanEnd = new Date(Date.UTC(Number(nextPlanPeriod.slice(0, 4)), Number(nextPlanPeriod.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { roles } = await getCurrentRoleCodes(supabase, user);
  if (!hasAnyRole(roles, ["store_manager", "super_admin", "developer"])) redirect("/");

  const stores = (await getAccessibleStores(supabase))
    .filter((store) => store.status !== "archived" && isRetailStoreForMotivation(store.name));
  const storeIds = stores.map((store) => store.id);
  if (!storeIds.length) {
    return <DashboardView initialPeriod={period} periods={periods} initialMainTab={mainTab} initialStoreTab={storeTab} stores={[]} storeMetrics={[]} employeeMetrics={[]} openShifts={0} message={params.message} detail={params.detail} />;
  }

  const [storeDetailsResult, plansResult, nextPlanRowsResult, shiftRows, taskRows, checklistRows, scheduleRows, cashRows, assignments, payrollPeriod, historicalRowsResult, historicalDayRows, yearlyShiftRows, yearPlansResult] = await Promise.all([
    supabase.from("stores").select("id, name, city, timezone, workday_start_time, workday_end_time, status").in("id", storeIds).returns<StoreDetailRow[]>(),
    supabase.from("store_sales_plans").select("store_id, sales_plan_amount, average_check_target, check_depth_target, is_auto_generated").eq("period_start", periodStart).eq("period_end", periodEnd).in("store_id", storeIds).returns<PlanRow[]>(),
    supabase.from("store_sales_plans").select("store_id, sales_plan_amount, average_check_target, check_depth_target, is_auto_generated").eq("period_start", nextPlanStart).eq("period_end", nextPlanEnd).in("store_id", storeIds).returns<PlanRow[]>(),
    fetchPages<ShiftRow>((from, to) => supabase.from("shifts")
      .select("id, store_id, shift_date, status, opened_at, closed_at, is_erroneous, shift_closing_reports(cash_revenue, card_revenue, cash_returns, card_returns, net_revenue, receipt_count, items_sold_count), shift_participants(employee_id, participant_role, employees(id, full_name), shift_work_times(paid_hours, confirmed_at))")
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
      .select("employee_id, store_id, valid_from, valid_to, employees(id, full_name, is_active)")
      .in("store_id", storeIds).lte("valid_from", periodEnd)
      .or(`valid_to.is.null,valid_to.gte.${periodStart}`)
      .range(from, to).returns<AssignmentRow[]>()),
    supabase.from("payroll_periods").select("id").eq("period_month", periodStart).maybeSingle<{ id: string }>(),
    fetchPages<HistoricalMonthRow>((from, to) => supabase.from("store_monthly_historical_analytics")
      .select("store_id, period_start, revenue_amount, returns_amount, receipt_count, items_sold_count, active_days, missing_revenue_days, missing_receipt_days, missing_item_days, seasonality_coefficient")
      .in("store_id", storeIds).order("period_start").range(from, to).returns<HistoricalMonthRow[]>()),
    fetchPages<HistoricalDayRow>((from, to) => supabase.from("store_daily_historical_analytics")
      .select("store_id, sales_date, revenue_amount, returns_amount, receipt_count, items_sold_count, nonzero_turnover_shifts")
      .in("store_id", storeIds).gte("sales_date", periodStart).lt("sales_date", nextMonth)
      .order("sales_date").range(from, to).returns<HistoricalDayRow[]>()),
    fetchPages<MonthlyShiftRow>((from, to) => supabase.from("shifts")
      .select("store_id, shift_date, status, is_erroneous, shift_closing_reports(gross_revenue, cash_revenue, card_revenue, cash_returns, card_returns, receipt_count, items_sold_count)")
      .in("store_id", storeIds).gte("shift_date", yearStart).lt("shift_date", nextYear)
      .order("shift_date").range(from, to).returns<MonthlyShiftRow[]>()),
    supabase.from("store_sales_plans").select("store_id, period_start, sales_plan_amount")
      .in("store_id", storeIds).gte("period_start", yearStart).lt("period_start", nextYear).returns<YearPlanRow[]>(),
  ]);

  if (storeDetailsResult.error) throw new Error(storeDetailsResult.error.message);
  if (plansResult.error) throw new Error(plansResult.error.message);
  if (nextPlanRowsResult.error) throw new Error(nextPlanRowsResult.error.message);
  const cashCountError = cashRows.find((result) => result.error)?.error;
  if (cashCountError) throw new Error(cashCountError.message);
  if (payrollPeriod.error) throw new Error(payrollPeriod.error.message);
  if (yearPlansResult.error) throw new Error(yearPlansResult.error.message);
  const storeDetails = storeDetailsResult.data ?? [];
  const storeById = new Map(storeDetails.map((store) => [store.id, store]));
  const relevantShiftRows = shiftRows.filter((shift) => !(storeById.get(shift.store_id)?.name === "Урбан" && shift.shift_date < "2026-08-01"));
  const dailyHistoryByStore = new Map<string, HistoricalDayRow[]>();
  for (const row of historicalDayRows) {
    const dailyRows = dailyHistoryByStore.get(row.store_id) ?? [];
    dailyRows.push(row);
    dailyHistoryByStore.set(row.store_id, dailyRows);
  }
  const planByStore = new Map((plansResult.data ?? []).map((plan) => [plan.store_id, plan]));
  const currentOpenQuery = await supabase.from("shifts").select("id", { count: "exact", head: true })
    .in("store_id", storeIds).in("status", ["opened", "correction_required"]);
  if (currentOpenQuery.error) throw new Error(currentOpenQuery.error.message);

  const employeeMap = new Map<string, { id: string; name: string; stores: Set<string> }>();
  for (const assignment of assignments) {
    const employee = one(assignment.employees);
    if (!employee?.is_active || assignment.valid_from > periodEnd || (assignment.valid_to && assignment.valid_to < periodStart)) continue;
    const value = employeeMap.get(employee.id) ?? { id: employee.id, name: employee.full_name, stores: new Set<string>() };
    value.stores.add(assignment.store_id);
    employeeMap.set(employee.id, value);
  }
  for (const shift of relevantShiftRows) for (const participant of shift.shift_participants) {
    const person = one(participant.employees);
    if (!person) continue;
    const value = employeeMap.get(person.id) ?? { id: person.id, name: person.full_name, stores: new Set<string>() };
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
  const historyByStore = new Map<string, Map<string, StoreMonthlyMetric>>();
  const planByStoreMonth = new Map((yearPlansResult.data ?? []).map((row) => [`${row.store_id}:${row.period_start.slice(0, 7)}`, asNumber(row.sales_plan_amount)]));
  for (const row of historicalRowsResult) {
    const period = row.period_start.slice(0, 7);
    const key = `${row.store_id}:${period}`;
    const revenue = asNumber(row.revenue_amount);
    const receipts = Number(row.receipt_count || 0);
    const itemsSold = Number(row.items_sold_count ?? 0);
    const missingRevenue = Number(row.missing_revenue_days || 0);
    const missingReceipts = Number(row.missing_receipt_days || 0);
    const missingItems = Number(row.missing_item_days || 0);
    const month: StoreMonthlyMetric = {
      period, revenue, returns: asNumber(row.returns_amount), receipts, itemsSold,
      averageCheck: receipts > 0 ? (revenue - asNumber(row.returns_amount)) / receipts : null,
      checkDepth: receipts > 0 ? itemsSold / receipts : null,
      salesPlan: planByStoreMonth.get(key) ?? null,
      seasonality: row.seasonality_coefficient == null ? null : asNumber(row.seasonality_coefficient),
      activeDays: Number(row.active_days || 0), missingRevenue, missingReceipts, missingItems,
      missingItemsUnit: "дн.", source: "cash-sheet",
    };
    const months = historyByStore.get(row.store_id) ?? new Map<string, StoreMonthlyMetric>();
    months.set(period, month);
    historyByStore.set(row.store_id, months);
  }
  const liveMonthAccumulators = new Map<string, {
    storeId: string; period: string; revenue: number; returns: number; receipts: number; items: number;
    averageRevenue: number; averageReturns: number; averageReceipts: number;
    knownRevenue: number; knownReceipts: number; knownItems: number; missingRevenue: number; missingReceipts: number;
    missingItems: number; itemReceipts: number; dates: Set<string>;
  }>();
  for (const shift of yearlyShiftRows) {
    if (storeById.get(shift.store_id)?.name === "Урбан" && shift.shift_date < "2026-08-01") continue;
    if (shift.is_erroneous || !["closed", "auto_closed"].includes(shift.status)) continue;
    const period = shift.shift_date.slice(0, 7);
    const key = `${shift.store_id}:${period}`;
    const accumulator = liveMonthAccumulators.get(key) ?? {
      storeId: shift.store_id, period, revenue: 0, returns: 0, receipts: 0, items: 0,
      averageRevenue: 0, averageReturns: 0, averageReceipts: 0,
      knownRevenue: 0, knownReceipts: 0, knownItems: 0, missingRevenue: 0, missingReceipts: 0,
      missingItems: 0, itemReceipts: 0, dates: new Set<string>(),
    };
    accumulator.dates.add(shift.shift_date);
    const report = one(shift.shift_closing_reports);
    if (!report) {
      accumulator.missingRevenue++;
      accumulator.missingReceipts++;
      accumulator.missingItems++;
      liveMonthAccumulators.set(key, accumulator);
      continue;
    }
    const gross = report.gross_revenue != null
      ? asNumber(report.gross_revenue)
      : report.cash_revenue != null && report.card_revenue != null
        ? asNumber(report.cash_revenue) + asNumber(report.card_revenue)
        : null;
    if (gross === null) accumulator.missingRevenue++;
    else { accumulator.revenue += gross; accumulator.knownRevenue++; }
    accumulator.returns += asNumber(report.cash_returns) + asNumber(report.card_returns);
    if (report.receipt_count === null) accumulator.missingReceipts++;
    else { accumulator.receipts += Number(report.receipt_count); accumulator.knownReceipts++; }
    if (gross !== null && report.receipt_count !== null && report.receipt_count > 0) {
      accumulator.averageRevenue += gross;
      accumulator.averageReturns += asNumber(report.cash_returns) + asNumber(report.card_returns);
      accumulator.averageReceipts += Number(report.receipt_count);
    }
    if (report.items_sold_count === null) accumulator.missingItems++;
    else {
      accumulator.items += Number(report.items_sold_count);
      accumulator.knownItems++;
      accumulator.itemReceipts += Number(report.receipt_count || 0);
    }
    liveMonthAccumulators.set(key, accumulator);
  }
  for (const [key, row] of liveMonthAccumulators) {
    const itemMonth = historyByStore.get(row.storeId) ?? new Map<string, StoreMonthlyMetric>();
    const existing = itemMonth.get(row.period);
    if (existing?.source === "cash-sheet" && row.period !== currentMonth) continue;
    const receipts = row.receipts;
    const itemsSold = row.knownItems > 0 ? row.items : null;
    itemMonth.set(row.period, {
      period: row.period,
      revenue: row.revenue,
      returns: row.returns,
      receipts,
      itemsSold,
      averageCheck: row.averageReceipts > 0 ? (row.averageRevenue - row.averageReturns) / row.averageReceipts : null,
      checkDepth: row.itemReceipts > 0 ? row.items / row.itemReceipts : null,
      salesPlan: planByStoreMonth.get(key) ?? null,
      seasonality: existing?.seasonality ?? null,
      activeDays: row.dates.size,
      missingRevenue: row.missingRevenue,
      missingReceipts: row.missingReceipts,
      missingItems: row.missingItems,
      missingItemsUnit: "см.",
      source: "app",
    });
    historyByStore.set(row.storeId, itemMonth);
  }
  for (const [storeId, months] of historyByStore) {
    for (const [monthKey, month] of months) {
      month.salesPlan = planByStoreMonth.get(`${storeId}:${monthKey}`) ?? null;
    }
  }

  const generatedPlans: Array<{
    store_id: string; period_start: string; period_end: string; sales_plan_amount: number;
    average_check_target: number | null; check_depth_target: number | null;
    is_auto_generated: boolean; updated_by: string;
  }> = [];
  const nextPlanByStore = new Map((nextPlanRowsResult.data ?? []).map((plan) => [plan.store_id, plan]));
  const generationPeriods = new Set([nextPlanPeriod, ...(period > currentMonth ? [period] : [])]);
  for (const generationPeriod of generationPeriods) {
    const generationStart = `${generationPeriod}-01`;
    const generationEnd = new Date(Date.UTC(Number(generationPeriod.slice(0, 4)), Number(generationPeriod.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const existingPlans = generationPeriod === period ? planByStore : nextPlanByStore;
    for (const store of storeDetails) {
    if (!isRetailStoreForMotivation(store.name) || existingPlans.has(store.id)) continue;
    const observations = [...(historyByStore.get(store.id)?.values() ?? [])].map((row) => ({
      period: row.period,
      revenue: row.revenue,
      returns: row.returns,
      receipts: row.receipts,
      itemsSold: row.itemsSold,
      activeDays: row.activeDays,
      missingRevenue: row.missingRevenue,
      missingReceipts: row.missingReceipts,
      missingItems: row.missingItems,
    }));
    const completedObservations = observations.filter((row) => row.period < currentMonth);
    const forecast = forecastStorePlan(store.name, generationPeriod, completedObservations);
    if (forecast.sales === null) continue;
    const generated = {
      store_id: store.id,
      period_start: generationStart,
      period_end: generationEnd,
      sales_plan_amount: forecast.sales,
      average_check_target: forecast.averageCheck,
      check_depth_target: forecast.checkDepth,
      is_auto_generated: true,
      updated_by: user.id,
    };
    generatedPlans.push(generated);
    const generatedPlan: PlanRow = {
      store_id: store.id,
      sales_plan_amount: forecast.sales,
      average_check_target: forecast.averageCheck,
      check_depth_target: forecast.checkDepth,
      is_auto_generated: true,
    };
    existingPlans.set(store.id, generatedPlan);
    planByStoreMonth.set(`${store.id}:${generationPeriod}`, forecast.sales);
    if (generationPeriod === period) planByStore.set(store.id, generatedPlan);
    }
  }
  if (generatedPlans.length) {
    const { error } = await supabase.from("store_sales_plans")
      .upsert(generatedPlans, { onConflict: "store_id,period_start,period_end" });
    if (error) throw new Error(`Не удалось сохранить автоматические планы: ${error.message}`);
  }

  const taskAssignmentsByEmployee = new Map<string, TaskRow[]>();
  for (const task of taskRows) {
    if (!task.due_at || task.status === "cancelled") continue;
    const timeZone = storeById.get(task.store_id)?.timezone ?? "Asia/Vladivostok";
    const createdLocalDate = localDateAt(task.created_at, timeZone);
    const dueLocalDate = localDateAt(task.due_at, timeZone);
    if (!dueLocalDate || dueLocalDate < periodStart || dueLocalDate > periodEnd) continue;
    const creditedEmployeeIds = task.assignee_employee_id
      ? [task.assignee_employee_id]
      : [...new Set(relevantShiftRows.filter((shift) => shift.store_id === task.store_id && !shift.is_erroneous && shift.status === "closed" && createdLocalDate && shift.shift_date >= createdLocalDate && shift.shift_date <= dueLocalDate)
        .flatMap((shift) => shift.shift_participants.map((participant) => participant.employee_id)))];
    for (const employeeId of creditedEmployeeIds) {
      const assigned = taskAssignmentsByEmployee.get(employeeId) ?? [];
      assigned.push(task);
      taskAssignmentsByEmployee.set(employeeId, assigned);
    }
  }

  const storeMetrics: DashboardData["storeMetrics"] = storeDetails.map((store) => {
    const rows = relevantShiftRows.filter((shift) => shift.store_id === store.id);
    const validShifts = rows.filter((shift) => !shift.is_erroneous && shift.status === "closed");
    const reports = validShifts.map((shift) => one(shift.shift_closing_reports)).filter((row): row is ReportRow => Boolean(row));
    const appNet = reports.reduce((sum, row) => sum + asNumber(row.net_revenue), 0);
    const appGross = reports.reduce((sum, row) => sum + asNumber(row.cash_revenue) + asNumber(row.card_revenue), 0);
    const appReturns = reports.reduce((sum, row) => sum + asNumber(row.cash_returns) + asNumber(row.card_returns), 0);
    const appReceipts = reports.reduce((sum, row) => sum + Number(row.receipt_count || 0), 0);
    const reportsWithItems = reports.filter((row) => row.items_sold_count !== null);
    const appItems = reportsWithItems.length ? reportsWithItems.reduce((sum, row) => sum + Number(row.items_sold_count), 0) : null;
    const itemsReceipts = reportsWithItems.reduce((sum, row) => sum + Number(row.receipt_count || 0), 0);
    const historicalMonth = historyByStore.get(store.id)?.get(period);
    const historicalDays = dailyHistoryByStore.get(store.id) ?? [];
    const hasHistoricalMonth = period !== currentMonth && historicalMonth?.source === "cash-sheet";
    const gross = hasHistoricalMonth ? historicalMonth.revenue : appGross;
    const returns = hasHistoricalMonth ? historicalMonth.returns : appReturns;
    const receipts = hasHistoricalMonth ? historicalMonth.receipts : appReceipts;
    const items = hasHistoricalMonth ? historicalMonth.itemsSold : appItems;
    const net = hasHistoricalMonth ? gross - returns : appNet;
    const comparableItemsReceipts = hasHistoricalMonth ? receipts : itemsReceipts;
    const storeTasks = taskRows.filter((task) => task.store_id === store.id);
    const dueTasks = storeTasks.filter((task) => {
      const dueLocalDate = localDateAt(task.due_at, store.timezone ?? "Asia/Vladivostok");
      return dueLocalDate && dueLocalDate >= periodStart && dueLocalDate <= periodEnd && task.status !== "cancelled";
    });
    const checks = checklistRows.filter((row) => row.store_id === store.id);
    const plan = planByStore.get(store.id) ?? null;
    const averageCheck = hasHistoricalMonth ? historicalMonth.averageCheck : receipts ? net / receipts : null;
    const checkDepth = hasHistoricalMonth ? historicalMonth.checkDepth : comparableItemsReceipts && items !== null ? items / comparableItemsReceipts : null;
    const salesByDay = new Map<string, number>();
    for (const shift of validShifts) {
      const report = one(shift.shift_closing_reports);
      salesByDay.set(shift.shift_date, (salesByDay.get(shift.shift_date) ?? 0) + asNumber(report?.net_revenue));
    }
    const onTimeTasks = dueTasks.filter((task) => task.status === "done" && task.completed_at && task.due_at && new Date(task.completed_at) <= new Date(task.due_at)).length;
    const importedDays = hasHistoricalMonth && historicalDays.length
      ? historicalDays.map((row) => ({ date: row.sales_date, amount: asNumber(row.revenue_amount) }))
      : null;
    return {
      id: store.id, name: store.name, city: store.city,
      netRevenue: net, grossRevenue: gross, returns, receipts, itemsSold: items, itemsReceipts: comparableItemsReceipts, averageCheck,
      checkDepth,
      shiftCount: importedDays ? historicalDays.reduce((sum, day) => sum + Number(day.nonzero_turnover_shifts || 0), 0) : validShifts.length, erroneousShiftCount: rows.filter((shift) => shift.is_erroneous).length,
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
      dailySales: importedDays ?? [...salesByDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => ({ date, amount })),
      monthlyHistory: [...(historyByStore.get(store.id)?.values() ?? [])].sort((a, b) => a.period.localeCompare(b.period)),
    };
  });

  const employeeMetrics: DashboardData["employeeMetrics"] = [...employeeMap.values()].map((employee) => {
    const participations = relevantShiftRows.flatMap((shift) => {
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
    const participationsWithItems = participations.filter(({ report }) => report.items_sold_count !== null);
    const receipts = participations.reduce((sum, row) => sum + row.report.receipt_count, 0);
    const net = participations.reduce((sum, row) => sum + asNumber(row.report.net_revenue), 0);
    const byStore = Object.fromEntries([...employee.stores].map((storeId) => {
      const storeParticipations = participations.filter((row) => row.shift.store_id === storeId);
      const storeTasks = assignedTasks.filter((task) => task.store_id === storeId);
      const storeChecks = checklistRows.filter((row) => row.employee_id === employee.id && row.store_id === storeId);
      const storeReceipts = storeParticipations.reduce((sum, row) => sum + row.report.receipt_count, 0);
      const storeParticipationsWithItems = storeParticipations.filter(({ report }) => report.items_sold_count !== null);
      const storeItems = storeParticipationsWithItems.length
        ? storeParticipationsWithItems.reduce((sum, row) => sum + Number(row.report.items_sold_count), 0)
        : null;
      const storeItemsReceipts = storeParticipationsWithItems.reduce((sum, row) => sum + Number(row.report.receipt_count || 0), 0);
      return [storeId, {
        shiftCount: new Set(storeParticipations.map((row) => row.shift.id)).size,
        confirmedHours: storeParticipations.reduce((sum, row) => sum + (row.hours ?? 0), 0),
        netRevenue: storeParticipations.reduce((sum, row) => sum + asNumber(row.report.net_revenue), 0),
        grossRevenue: storeParticipations.reduce((sum, row) => sum + asNumber(row.report.cash_revenue) + asNumber(row.report.card_revenue), 0),
        returns: storeParticipations.reduce((sum, row) => sum + asNumber(row.report.cash_returns) + asNumber(row.report.card_returns), 0),
        receipts: storeReceipts,
        itemsSold: storeItems,
        itemsReceipts: storeItemsReceipts,
        averageCheck: storeReceipts ? storeParticipations.reduce((sum, row) => sum + asNumber(row.report.net_revenue), 0) / storeReceipts : null,
        checkDepth: storeItemsReceipts && storeItems !== null ? storeItems / storeItemsReceipts : null,
        taskDueCount: storeTasks.length,
        taskDone: storeTasks.filter((task) => task.status === "done").length,
        taskOnTime: storeTasks.filter((task) => task.status === "done" && task.completed_at && new Date(task.completed_at) <= new Date(task.due_at!)).length,
        checklistCount: storeChecks.length,
        checklistAverage: storeChecks.length ? storeChecks.reduce((sum, row) => sum + asNumber(row.average_score), 0) / storeChecks.length : null,
      } satisfies DashboardData["employeeMetrics"][number]["byStore"][string]];
    }));
    const payrollEntry = payrollByEmployee.get(employee.id);
    const academySnapshot = payrollEntry?.calculation_snapshot?.academy_payroll;
    const academyBreakdown = academySnapshot && typeof academySnapshot === "object" ? academySnapshot as Record<string, unknown> : null;
    return {
      id: employee.id, name: employee.name, level: levels.get(employee.id)?.level ?? null,
      storeIds: [...employee.stores],
      byStore,
      stores: [...employee.stores].map((id) => storeById.get(id)?.name ?? "").filter(Boolean),
      shiftCount: new Set(participations.map((row) => row.shift.id)).size,
      confirmedHours: checkedHours,
      participationRevenue: net,
      grossParticipationRevenue: participations.reduce((sum, row) => sum + asNumber(row.report.cash_revenue) + asNumber(row.report.card_revenue), 0),
      returns: participations.reduce((sum, row) => sum + asNumber(row.report.cash_returns) + asNumber(row.report.card_returns), 0),
      receipts,
      itemsSold: participationsWithItems.length ? participationsWithItems.reduce((sum, row) => sum + Number(row.report.items_sold_count), 0) : null,
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
    periods={periods}
    initialMainTab={mainTab}
    initialStoreTab={storeTab}
    stores={stores.map(({ id, name, city }) => ({ id, name, city }))}
    storeMetrics={storeMetrics}
    employeeMetrics={employeeMetrics}
    openShifts={openShifts}
    message={params.message}
    detail={params.detail}
  />;
}
