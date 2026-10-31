"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowUpRight, Banknote, BellRing, CalendarClock, CalendarDays, CheckCheck, ChevronDown, Calculator,
  ClipboardCheck, LayoutDashboard, ListChecks, Plus, Search, Settings, ShieldCheck, Store,
  UsersRound, WalletCards,
} from "lucide-react";

type DailyPoint = { date: string; amount: number };
export type StoreMonthlyMetric = {
  period: string;
  revenue: number;
  returns: number;
  receipts: number;
  itemsSold: number | null;
  averageCheck: number | null;
  checkDepth: number | null;
  salesPlan: number | null;
  seasonality: number | null;
  activeDays: number;
  missingRevenue: number;
  missingReceipts: number;
  missingItems: number;
  missingItemsUnit: "дн." | "см.";
  source: "cash-sheet" | "app";
};
type StoreMetric = {
  id: string; name: string; city: string; netRevenue: number; grossRevenue: number; returns: number; receipts: number; itemsSold: number | null; itemsReceipts: number;
  averageCheck: number | null; checkDepth: number | null; shiftCount: number; erroneousShiftCount: number;
  plannedShifts: number; salesPlan: number | null; planCompletion: number | null;
  averageCheckTarget: number | null; checkDepthTarget: number | null; averageCheckAchieved: boolean; checkDepthAchieved: boolean;
  taskOpen: number; taskOverdue: number; taskDone: number; taskOnTime: number; taskDueCount: number;
  checklistCount: number; checklistAverage: number | null; checklistScoreTotal: number; employeeCount: number;
  cashAmount: number | null; cashUpdatedAt: string | null; dailySales: DailyPoint[]; monthlyHistory: StoreMonthlyMetric[];
};
type EmployeeMetric = {
  id: string; name: string; level: number | null; stores: string[]; storeIds: string[];
  shiftCount: number; confirmedHours: number;
  participationRevenue: number; grossParticipationRevenue: number; returns: number; receipts: number; itemsSold: number | null; averageCheck: number | null;
  taskDueCount: number; taskDone: number; taskOnTime: number; checklistCount: number;
  checklistAverage: number | null; payroll: number | null;
  byStore: Record<string, EmployeeStoreMetric>;
  payrollParts: null | {
    mode: "academy" | "legacy"; sales: number; base: number; bonus: number; advances: number; deductions: number;
    hourly: number; commission: number; taskBonus: number; checklistBonus: number; commercialKpiBonus: number;
    contestBonus: number; networkPackage: number; mentorshipPackage: number; paidHours: number;
  };
};
type EmployeeStoreMetric = {
  shiftCount: number; confirmedHours: number;
  netRevenue: number; grossRevenue: number; returns: number; receipts: number;
  itemsSold: number | null; itemsReceipts: number; averageCheck: number | null; checkDepth: number | null;
  taskDueCount: number; taskDone: number; taskOnTime: number;
  checklistCount: number; checklistAverage: number | null;
};

export type DashboardData = {
  storeMetrics: StoreMetric[];
  employeeMetrics: EmployeeMetric[];
};

type Props = DashboardData & {
  initialPeriod: string;
  periods: { overview: string; employees: string; stores: string; goals: string };
  initialMainTab: "overview" | "stores";
  initialStoreTab: "employees" | "stores" | "goals";
  stores: Array<{ id: string; name: string; city: string }>;
  openShifts: number;
  message?: string;
  detail?: string;
};

const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
const rubles = (value: number | null) => value === null ? "—" : `${number.format(Math.round(value))} ₽`;
const preciseRubles = (value: number | null) => value === null ? "—" : `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)} ₽`;
const pct = (value: number | null) => value === null ? "—" : `${decimal.format(value)}%`;
const metric = (value: number | null, digits = 2) => value === null ? "—" : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(value);

function localMonthName(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}-01T00:00:00Z`));
}

function monthShortName(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { month: "short", timeZone: "UTC" }).format(new Date(`${value}-01T00:00:00Z`));
}

function seasonalityForMonth(
  store: StoreMetric,
  allStores: StoreMetric[],
  period: string,
): { value: number | null; reference: string | null; fallback: boolean } {
  const [year, month] = period.split("-");
  const referenceYear = String(Number(year) - 1);
  const storeYear = store.monthlyHistory.filter((item) => item.source === "cash-sheet" && item.period.startsWith(`${referenceYear}-`));
  const storeMonth = storeYear.find((item) => item.period === `${referenceYear}-${month}`);
  const fallback = !storeMonth;
  const referenceStore = fallback
    ? allStores.find((item) => item.name.trim().toLocaleLowerCase("ru") === "ленинградская")
    : store;
  if (!referenceStore) return { value: null, reference: null, fallback };

  const referenceMonths = fallback
    ? referenceStore.monthlyHistory.filter((item) => item.source === "cash-sheet" && item.period.startsWith(`${referenceYear}-`))
    : storeYear;
  const sameMonth = fallback
    ? referenceMonths.find((item) => item.period === `${referenceYear}-${month}`)
    : storeMonth;
  if (!sameMonth || referenceMonths.length === 0) return { value: null, reference: null, fallback };

  const averageRevenue = referenceMonths.reduce((sum, item) => sum + item.revenue, 0) / referenceMonths.length;
  return {
    value: averageRevenue > 0 ? sameMonth.revenue / averageRevenue : null,
    reference: referenceYear,
    fallback,
  };
}

function Progress({ value, tone = "red" }: { value: number | null; tone?: "red" | "gold" | "green" }) {
  const color = tone === "green" ? "bg-emerald-400" : tone === "gold" ? "bg-amber-300" : "bg-brand";
  const width = value === null ? 0 : Math.min(100, Math.max(0, value));
  return <div className="h-1.5 overflow-hidden rounded-full bg-white/8"><div className={`h-full rounded-full ${color}`} style={{ width: `${width}%` }} /></div>;
}

function MetricCard({ label, value, hint, icon: Icon, alert = false }: {
  label: string; value: string; hint: string; icon: typeof Store; alert?: boolean;
}) {
  return <article className={`min-w-0 rounded-lg border bg-[#0c090a]/95 px-4 py-3 ${alert ? "border-red-400/35" : "border-white/8"}`}>
    <div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-wide text-white/55">
      <span className="truncate">{label}</span><Icon size={15} className={alert ? "shrink-0 text-brand" : "shrink-0 text-amber-100/60"} />
    </div>
    <div className="mt-2 truncate text-[22px] font-semibold leading-none tabular-nums">{value}</div>
    <div className="mt-2 truncate text-[11px] text-white/45">{hint}</div>
  </article>;
}

type GoalValues = { sales: string; average: string; depth: string };

function median(values: number[]) {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function suggestedKpiTarget(store: StoreMetric, period: string, key: "averageCheck" | "checkDepth") {
  const targetYear = Number(period.slice(0, 4));
  const observations = store.monthlyHistory
    .filter((row) => row.period < period && Number(row.period.slice(0, 4)) === targetYear)
    .map((row) => ({
      year: Number(row.period.slice(0, 4)), month: Number(row.period.slice(5, 7)),
      value: row[key],
      complete: row.missingReceipts === 0 && (key === "averageCheck"
        ? row.missingRevenue === 0
        : row.missingItems === 0),
    }));
  const baselineRows = observations
    .filter((row) => row.value !== null && row.value > 0)
    .sort((a, b) => b.year - a.year || b.month - a.month)
    .slice(0, 3);
  const baseline = median(baselineRows.map((row) => row.value!));
  if (baseline === null) return { value: null, partial: false, sampleMonths: 0 };

  const raw = baseline * 1.01;
  return {
    value: Math.round(raw * 100) / 100,
    partial: baselineRows.length < 3 || baselineRows.some((row) => !row.complete),
    sampleMonths: baselineRows.length,
  };
}

function GoalPlanner({ stores, period, periods }: { stores: StoreMetric[]; period: string; periods: Props["periods"] }) {
  const suggestions = useMemo(() => new Map(stores.map((store) => [store.id, {
    average: suggestedKpiTarget(store, period, "averageCheck"),
    depth: suggestedKpiTarget(store, period, "checkDepth"),
  }])), [stores, period]);
  const initialValues = useMemo(() => Object.fromEntries(stores.map((store) => {
    const suggestion = suggestions.get(store.id)!;
    return [store.id, {
      sales: store.salesPlan?.toString() ?? "",
      average: store.averageCheckTarget?.toString() ?? suggestion.average.value?.toFixed(2) ?? "",
      depth: store.checkDepthTarget?.toString() ?? suggestion.depth.value?.toFixed(2) ?? "",
    }];
  })), [stores, suggestions]);
  const [values, setValues] = useState<Record<string, GoalValues>>(initialValues);
  useEffect(() => setValues(initialValues), [initialValues]);
  const update = (storeId: string, field: keyof GoalValues, value: string) => setValues((current) => ({
    ...current, [storeId]: { ...(current[storeId] ?? { sales: "", average: "", depth: "" }), [field]: value },
  }));
  const applySuggestions = () => setValues((current) => Object.fromEntries(stores.map((store) => {
    const suggestion = suggestions.get(store.id)!;
    return [store.id, {
      ...current[store.id],
      sales: current[store.id]?.sales ?? "",
      average: suggestion.average.value?.toFixed(2) ?? "",
      depth: suggestion.depth.value?.toFixed(2) ?? "",
    }];
  })));

  return <form action={`/dashboard/goals/bulk-save?overviewPeriod=${periods.overview}&employeesPeriod=${periods.employees}&storesPeriod=${periods.stores}`} method="post" className="min-h-0 flex-1 overflow-auto">
    <input type="hidden" name="period" value={period} />
    <input type="hidden" name="overviewPeriod" value={periods.overview} />
    <input type="hidden" name="employeesPeriod" value={periods.employees} />
    <input type="hidden" name="storesPeriod" value={periods.stores} />
    <input type="hidden" name="mainTab" value="stores" />
    <input type="hidden" name="tab" value="goals" />
    <table className="w-full min-w-[980px] border-collapse text-left text-xs">
      <thead className="sticky top-0 z-10 bg-[#100c0d] text-[10px] uppercase tracking-wide text-white/45"><tr>
      <th className="px-4 py-3">Магазин</th><th className="px-3 py-3 text-right">Факт последнего месяца</th><th className="px-3 py-3">План оборота, ₽</th>
        <th className="px-3 py-3">Цель среднего чека, ₽</th><th className="px-3 py-3">Цель глубины чека</th><th className="px-3 py-3">Основание</th>
      </tr></thead>
      <tbody>{stores.map((store) => {
        const suggestion = suggestions.get(store.id)!;
        const current = values[store.id] ?? { sales: "", average: "", depth: "" };
        const previous = store.monthlyHistory.filter((row) => row.period < period).sort((a, b) => b.period.localeCompare(a.period))[0];
        const basis = suggestion.average.partial || suggestion.depth.partial
          ? `Текущий год · ${Math.min(suggestion.average.sampleMonths, suggestion.depth.sampleMonths)} мес. · есть пропуски`
          : "Текущий год · последние 3 месяца";
        return <tr key={store.id} className="border-t border-white/8 hover:bg-white/[0.025]">
          <td className="px-4 py-3"><div className="font-semibold">{store.name}</div><div className="mt-0.5 text-[10px] text-white/40">{store.city}</div><input type="hidden" name="store_ids" value={store.id} /></td>
          <td className="px-3 py-3 text-right tabular-nums"><div>{rubles(previous?.averageCheck ?? null)}</div><div className="mt-0.5 text-[10px] text-white/40">глубина {metric(previous?.checkDepth ?? null)}</div></td>
          <td className="px-3 py-3"><input aria-label={`${store.name}: план оборота`} name={`sales_plan_amount:${store.id}`} type="number" min="0" step="1" value={current.sales} onChange={(event) => update(store.id, "sales", event.target.value)} placeholder="Не задан" className="h-9 w-full rounded border border-white/10 bg-black/50 px-2 text-right text-xs tabular-nums text-white placeholder:text-white/35" /></td>
          <td className="px-3 py-3"><input aria-label={`${store.name}: цель среднего чека`} name={`average_check_target:${store.id}`} type="number" min="0.01" step="0.01" value={current.average} onChange={(event) => update(store.id, "average", event.target.value)} placeholder={suggestion.average.value === null ? "Нет данных" : undefined} className="h-9 w-full rounded border border-white/10 bg-black/50 px-2 text-right text-xs tabular-nums text-white placeholder:text-white/35" /></td>
          <td className="px-3 py-3"><input aria-label={`${store.name}: цель глубины чека`} name={`check_depth_target:${store.id}`} type="number" min="0.01" step="0.01" value={current.depth} onChange={(event) => update(store.id, "depth", event.target.value)} placeholder={suggestion.depth.value === null ? "Нет данных" : undefined} className="h-9 w-full rounded border border-white/10 bg-black/50 px-2 text-right text-xs tabular-nums text-white placeholder:text-white/35" /></td>
          <td className="px-3 py-3 text-[10px] leading-4 text-white/45"><div>{basis}</div><div className="mt-1 text-white/65">Автоцель: {preciseRubles(suggestion.average.value)} / {metric(suggestion.depth.value)}</div>{suggestion.average.value === null || suggestion.depth.value === null ? <div className="text-amber-200/70">Нет достаточных данных для одной из целей</div> : null}</td>
        </tr>;
      })}{stores.length === 0 ? <tr><td colSpan={6} className="px-4 py-10 text-center text-white/40">Нет магазинов по выбранным фильтрам.</td></tr> : null}</tbody>
    </table>
    <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-[#090708] px-4 py-3">
      <p className="max-w-3xl text-[10px] leading-4 text-white/45">Автоплан оборота: выручка того же месяца прошлого года × динамика сопоставимого периода × 1,10. Средний чек и глубина: медиана до 3 последних завершённых месяцев × 1,01. При открытии дашборда создаются отсутствующие цели на следующий месяц; существующие планы не перезаписываются.</p>
      <button type="button" onClick={applySuggestions} disabled={!stores.some((store) => suggestions.get(store.id)?.average.value !== null && suggestions.get(store.id)?.depth.value !== null)} className="h-9 rounded-md border border-white/10 px-3 text-xs font-semibold text-white/70 hover:bg-white/5 disabled:opacity-40">Подставить автоцели</button>
      <button type="submit" disabled={!stores.length} className="h-9 rounded-md border border-brand/35 bg-brand/15 px-4 text-xs font-semibold text-white hover:bg-brand/25 disabled:opacity-50">Сохранить цели на месяц</button>
    </div>
  </form>;
}

function Bars({ points, period, emptyLabel }: { points: DailyPoint[]; period: string; emptyLabel?: string }) {
  const byDate = new Map(points.map((point) => [point.date, point.amount]));
  const [year, month] = period.split("-").map(Number);
  const monthEnd = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const currentPeriod = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Vladivostok", year: "numeric", month: "2-digit" }).format(new Date()) === period;
  const today = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Vladivostok", day: "2-digit" }).format(new Date()));
  const lastDay = currentPeriod ? Math.min(monthEnd, today) : monthEnd;
  const firstDay = 1;
  const selected = Array.from({ length: lastDay - firstDay + 1 }, (_, index) => {
    const date = `${period}-${String(firstDay + index).padStart(2, "0")}`;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    return { date, amount: byDate.get(date) ?? 0, isWeekend: weekday === 0 || weekday === 6 };
  });
  const maximum = Math.max(1, ...selected.map((point) => point.amount));
  return <div className="flex h-[102px] items-end gap-1" aria-label="Выручка по дням за выбранный месяц">
    {selected.length ? selected.map((point) => <div key={point.date} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
      <div className="absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded border border-white/10 bg-black px-2 py-1 text-[10px] group-hover:block">
        {point.date.slice(8)} · {point.isWeekend ? "Выходной · " : ""}{rubles(point.amount)}
      </div>
      <div className={`min-h-[3px] rounded-t-sm ${point.isWeekend ? "bg-gradient-to-t from-emerald-800 to-emerald-400/90" : "bg-gradient-to-t from-red-800 to-red-400/90"}`} style={{ height: `${Math.max(3, point.amount / maximum * 100)}%` }} />
      <span className="mt-1 text-center text-[9px] text-white/40">{point.date.slice(8)}</span>
    </div>) : <p className="self-center text-xs text-white/40">{emptyLabel ?? "Нет закрытых смен за период"}</p>}
  </div>;
}

export function DashboardView({ initialPeriod, periods, initialMainTab, initialStoreTab, stores, storeMetrics, employeeMetrics, openShifts, message, detail }: Props) {
  const router = useRouter();
  const [city, setCity] = useState("");
  const [storeId, setStoreId] = useState("");
  const [mainTab, setMainTab] = useState<"overview" | "stores">(initialMainTab);
  const [tab, setTab] = useState<"stores" | "employees" | "goals">(initialStoreTab);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [quickTaskOpen, setQuickTaskOpen] = useState(false);
  const [taskStoreId, setTaskStoreId] = useState(stores[0]?.id ?? "");
  const [periodChoices, setPeriodChoices] = useState(periods);
  useEffect(() => setPeriodChoices(periods), [periods]);
  useEffect(() => { setMainTab(initialMainTab); setTab(initialStoreTab); }, [initialMainTab, initialStoreTab]);
  const navigateTo = (nextMain: "overview" | "stores", nextTab: "employees" | "stores" | "goals", nextPeriod?: { key: keyof typeof periods; value: string }) => {
    const params = new URLSearchParams(window.location.search);
    params.set("mainTab", nextMain);
    params.set("tab", nextTab);
    if (nextPeriod) {
      params.set(nextPeriod.key === "overview" ? "overviewPeriod" : `${nextPeriod.key}Period`, nextPeriod.value);
      setPeriodChoices((current) => ({ ...current, [nextPeriod.key]: nextPeriod.value }));
    }
    router.push(`/dashboard?${params.toString()}`);
  };
  const activePeriod = mainTab === "overview" ? periodChoices.overview : periodChoices[tab];
  const formatMonth = localMonthName(activePeriod);
  const cities = useMemo(() => [...new Set(stores.map((store) => store.city))].sort((a, b) => a.localeCompare(b, "ru")), [stores]);
  const filteredStores = useMemo(() => storeMetrics.filter((store) => (!city || store.city === city) && (!storeId || store.id === storeId)), [storeMetrics, city, storeId]);
  const visibleStoreIds = useMemo(() => new Set(filteredStores.map((store) => store.id)), [filteredStores]);
  const employeesInStores = useMemo(() => employeeMetrics.filter((employee) => employee.storeIds.some((id) => visibleStoreIds.has(id))), [employeeMetrics, visibleStoreIds]);
  const filteredEmployees = useMemo(() => employeesInStores.filter((employee) => !search || employee.name.toLocaleLowerCase("ru").includes(search.toLocaleLowerCase("ru"))), [employeesInStores, search]);
  const activeEmployees = employeesInStores.filter((employee) => employee.shiftCount > 0);
  const overview = useMemo(() => {
    const daily = new Map<string, number>();
    for (const store of filteredStores) for (const point of store.dailySales) daily.set(point.date, (daily.get(point.date) ?? 0) + point.amount);
    const periodRows = filteredStores.map((store) => ({
      store,
      history: store.monthlyHistory.find((month) => month.period === initialPeriod),
    }));
    const hasCashHistory = periodRows.some(({ history }) => history?.source === "cash-sheet");
    const revenue = periodRows.reduce((sum, { store, history }) => sum + (history?.revenue ?? store.grossRevenue), 0);
    const receipts = periodRows.reduce((sum, { store, history }) => sum + (history?.receipts ?? store.receipts), 0);
    const knownItems = periodRows.reduce((sum, { store, history }) => sum + (history?.itemsSold ?? store.itemsSold ?? 0), 0);
    const itemsReceipts = periodRows.reduce((sum, { store, history }) => sum + (history?.receipts ?? store.itemsReceipts), 0);
    const missingReceiptData = periodRows.some(({ history }) => history && history.missingReceipts > 0);
    const missingItemData = periodRows.some(({ history }) => history && history.missingItems > 0);
    const checks = filteredStores.reduce((sum, store) => sum + store.checklistCount, 0);
    const checklistScoreTotal = filteredStores.reduce((sum, store) => sum + store.checklistScoreTotal, 0);
    const due = filteredStores.reduce((sum, store) => sum + store.taskDueCount, 0);
    const onTime = filteredStores.reduce((sum, store) => sum + store.taskOnTime, 0);
    const delayed = filteredStores.reduce((sum, store) => sum + store.taskOverdue, 0);
    const cash = filteredStores.reduce((sum, store) => sum + (store.cashAmount ?? 0), 0);
    const cashKnown = filteredStores.some((store) => store.cashAmount !== null);
    const payout = employeesInStores.reduce((sum, employee) => sum + (employee.payroll ?? 0), 0);
    const payoutKnown = employeesInStores.some((employee) => employee.payroll !== null);
    return {
      revenue, receipts, avg: receipts ? revenue / receipts : null,
      depth: itemsReceipts ? knownItems / itemsReceipts : null,
      itemsReceipts, missingReceiptData, missingItemData,
      shifts: filteredStores.reduce((sum, store) => sum + store.shiftCount, 0),
      shiftsUnavailable: hasCashHistory && filteredStores.every((store) => store.shiftCount === 0),
      hasCashHistory,
      overdue: delayed, tasksDonePercent: due ? onTime / due * 100 : null,
      returns: periodRows.reduce((sum, { store, history }) => sum + (history?.returns ?? store.returns), 0),
      checklistCount: checks,
      checklistAvg: checks ? checklistScoreTotal / checks : null,
      cash: cashKnown ? cash : null, payout: payoutKnown ? payout : null,
      dailySales: [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => ({ date, amount })),
    };
  }, [filteredStores, employeesInStores, initialPeriod]);
  const availableStores = stores.filter((store) => !city || store.city === city);
  const visibleEmployees = filteredEmployees;
  const messageText = message === "task-created" ? "Задача создана и уведомления отправлены." : message === "dashboard-goals-saved" || message === "dashboard-bulk-goals-saved" ? "Цели магазинов сохранены." : message === "dashboard-error" ? detail ?? "Не удалось сохранить изменения." : null;

  return <main className="dashboard-font min-h-screen overflow-x-hidden px-4 py-4 text-[#f7f2ea] xl:h-screen xl:overflow-hidden xl:px-6 xl:py-5 2xl:px-8">
    <div className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-[1900px] flex-col gap-3 xl:h-full xl:min-h-0">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-3">
        <div className="flex items-center gap-3">
          <Link href="/" aria-label="На главную" className="grid size-10 place-items-center rounded-lg border border-white/10 bg-black/50 text-white/75 transition hover:border-red-400/50 hover:text-white"><ArrowLeft size={18} /></Link>
          <div><div className="flex items-center gap-2"><LayoutDashboard size={18} className="text-brand" /><h1 className="text-xl font-semibold">Операционный дашборд</h1></div>
            <p className="mt-0.5 text-xs capitalize text-white/45">{city || "Все города"} · {storeId ? stores.find((store) => store.id === storeId)?.name : "Все магазины"}</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 border-l border-white/10 pl-2">
            <QuickLink href="/tasks" label="Задачи" icon={ListChecks} />
            <QuickLink href="/admin/schedule" label="График работы" icon={CalendarDays} />
            <QuickLink href="/payroll" label="Зарплата" icon={WalletCards} />
            <QuickLink href="/cash" label="Наличные в кассе" icon={Banknote} />
            <QuickLink href="/checklists" label="Чек-листы" icon={ClipboardCheck} />
            <QuickLink href="/admin" label="Управление" icon={Settings} />
          </div>
          <Link href="/notifications" className="grid size-10 place-items-center rounded-lg border border-white/10 bg-black/45 text-white/65 hover:text-brand" title="Уведомления"><BellRing size={17} /></Link>
        </div>
      </header>

      {messageText ? <div role="status" className={`shrink-0 rounded-md border px-3 py-2 text-xs ${message === "dashboard-error" ? "border-red-400/25 bg-red-950/40 text-red-100" : "border-emerald-400/20 bg-emerald-950/25 text-emerald-100"}`}>
        {messageText}{detail && message !== "dashboard-error" ? <span className="ml-2 text-white/50">{detail}</span> : null}
      </div> : null}

      <nav className="flex shrink-0 items-center gap-1 border-b border-white/10" aria-label="Разделы дашборда" role="tablist">
        <button type="button" role="tab" aria-selected={mainTab === "overview"} onClick={() => navigateTo("overview", tab)} className={`border-b-2 px-4 py-2.5 text-sm font-semibold transition ${mainTab === "overview" ? "border-brand text-white" : "border-transparent text-white/45 hover:text-white/80"}`}>Общие показатели по городу</button>
        <button type="button" role="tab" aria-selected={mainTab === "stores"} onClick={() => navigateTo("stores", tab)} className={`border-b-2 px-4 py-2.5 text-sm font-semibold transition ${mainTab === "stores" ? "border-brand text-white" : "border-transparent text-white/45 hover:text-white/80"}`}>Показатели по магазинам</button>
      </nav>

      {mainTab === "overview" ? <>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-md border border-white/8 bg-black/35 px-3 py-2">
        <div><h2 className="text-sm font-semibold">Общие показатели по городу</h2><p className="text-[10px] capitalize text-white/40">{formatMonth}</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-9 items-center gap-2 rounded-md border border-white/10 bg-black/45 px-3 text-[11px] text-white/55"><CalendarClock size={14} /><span>Месяц</span><input aria-label="Месяц общих показателей" className="w-[125px] border-0 bg-transparent p-0 text-xs text-white outline-none" type="month" value={periodChoices.overview} onChange={(event) => navigateTo("overview", tab, { key: "overview", value: event.target.value })} /></label>
          <label className="flex h-9 items-center gap-2 rounded-md border border-white/10 bg-black/45 px-3"><span className="text-[10px] text-white/45">Город</span><select aria-label="Город общих показателей" value={city} onChange={(event) => { setCity(event.target.value); setStoreId(""); }} className="max-w-[140px] border-0 bg-transparent p-0 text-xs text-white outline-none"><option value="">Все</option>{cities.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
          <label className="flex h-9 items-center gap-2 rounded-md border border-white/10 bg-black/45 px-3"><span className="text-[10px] text-white/45">Магазин</span><select aria-label="Магазин общих показателей" value={storeId} onChange={(event) => setStoreId(event.target.value)} className="max-w-[170px] border-0 bg-transparent p-0 text-xs text-white outline-none"><option value="">Все</option>{availableStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
        </div>
      </div>
      {overview.hasCashHistory ? <p className="shrink-0 rounded-md border border-amber-200/10 bg-black/45 px-3 py-2 text-[11px] text-white/55">Пропуски чеков и товаров в старой кассовой истории считаются как 0. Каждая строка кассы с ненулевой выручкой считается закрытой сменой. Персональные смены, задачи и чек-листы из старого источника не импортированы.</p> : null}
      <section className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-5">
        <MetricCard label="Выручка" value={rubles(overview.revenue)} hint="Оборот магазина за выбранный период" icon={WalletCards} />
        <MetricCard label="Возвраты" value={rubles(overview.returns)} hint="Сумма возвратов за выбранный период" icon={ArrowUpRight} />
        <MetricCard label="Средний чек" value={rubles(overview.avg)} hint={`${number.format(overview.receipts)} чеков${overview.missingReceiptData ? " · пропуски = 0" : ""}`} icon={ArrowUpRight} />
        <MetricCard label="Глубина чека" value={metric(overview.depth)} hint={`${number.format(overview.itemsReceipts)} чеков · товары${overview.missingItemData ? " с пропусками = 0" : ""}`} icon={ListChecks} />
        <MetricCard label="Закрытые смены" value={overview.shiftsUnavailable ? "—" : number.format(overview.shifts)} hint={overview.shiftsUnavailable ? "История смен не импортирована" : `${number.format(openShifts)} открытых сейчас`} icon={Store} />
        <MetricCard label="Задачи в срок" value={pct(overview.tasksDonePercent)} hint={`${number.format(overview.overdue)} просрочено`} icon={CheckCheck} alert={overview.overdue > 0} />
        <MetricCard label="Чек-листы" value={metric(overview.checklistAvg)} hint={`${number.format(overview.checklistCount)} проверок · средний балл`} icon={ClipboardCheck} />
        <MetricCard label="Остаток наличных" value={rubles(overview.cash)} hint="Последний пересчёт по магазинам" icon={WalletCards} />
        <MetricCard label="Начислено в зарплату" value={rubles(overview.payout)} hint={overview.payout === null ? "Ведомость за месяц не рассчитана" : "Сумма рассчитанных зарплат сотрудников"} icon={UsersRound} />
      </section>

      <section className="grid min-h-[140px] shrink-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.75fr)]">
        <article className="rounded-lg border border-white/8 bg-[#0b0809]/90 px-4 py-3">
          <div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold">Выручка по дням</h2><p className="mt-0.5 text-[11px] text-white/40">Выбранный период · зелёные столбцы — выходные · наведите для суммы</p></div><span className="text-xs tabular-nums text-white/65">{rubles(overview.revenue)}</span></div>
          <div className="mt-3"><Bars points={overview.dailySales} period={initialPeriod} /></div>
        </article>
        <article className="grid grid-cols-2 gap-2 rounded-lg border border-white/8 bg-[#0b0809]/90 p-3 sm:grid-cols-4 xl:grid-cols-2">
          <div className="col-span-2 flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={16} className="text-amber-100/70" /> Контроль периода</div>
          <div className="rounded-md bg-white/[0.035] p-2"><p className="text-[10px] text-white/40">План продаж</p><p className="mt-1 text-sm font-medium">{filteredStores.some((store) => store.salesPlan !== null) ? pct(filteredStores.filter((store) => store.salesPlan !== null).reduce((sum, store) => sum + store.netRevenue, 0) / Math.max(1, filteredStores.filter((store) => store.salesPlan !== null).reduce((sum, store) => sum + (store.salesPlan ?? 0), 0)) * 100) : "Не задан"}</p></div>
          <div className="rounded-md bg-white/[0.035] p-2"><p className="text-[10px] text-white/40">Плановые смены</p><p className="mt-1 text-sm font-medium">{number.format(filteredStores.reduce((sum, store) => sum + store.plannedShifts, 0))}</p></div>
        </article>
      </section>

      </> : null}

      {mainTab === "stores" ? <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-white/8 bg-[#090708]/95">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
          <div className="flex items-center gap-1 rounded-md bg-black/50 p-1">
            <button onClick={() => { setExpandedId(null); navigateTo("stores", "employees"); }} className={`rounded px-3 py-1.5 text-xs font-semibold transition ${tab === "employees" ? "bg-white/10 text-white" : "text-white/45 hover:text-white"}`}><UsersRound size={14} className="mr-1.5 inline" />Сотрудники</button>
            <button onClick={() => { setExpandedId(null); navigateTo("stores", "stores"); }} className={`rounded px-3 py-1.5 text-xs font-semibold transition ${tab === "stores" ? "bg-white/10 text-white" : "text-white/45 hover:text-white"}`}><Store size={14} className="mr-1.5 inline" />Магазины</button>
            <button onClick={() => { setExpandedId(null); navigateTo("stores", "goals"); }} className={`rounded px-3 py-1.5 text-xs font-semibold transition ${tab === "goals" ? "bg-white/10 text-white" : "text-white/45 hover:text-white"}`}><Calculator size={14} className="mr-1.5 inline" />Планы KPI</button>
          </div>
          <label className="flex h-9 items-center gap-2 rounded-md border border-white/10 bg-black/45 px-3 text-[11px] text-white/55"><CalendarClock size={14} /><span>Месяц</span><input aria-label={`Месяц ${tab === "employees" ? "сотрудников" : tab === "stores" ? "магазинов" : "планов KPI"}`} className="w-[125px] border-0 bg-transparent p-0 text-xs text-white outline-none" type="month" value={periodChoices[tab]} onChange={(event) => navigateTo("stores", tab, { key: tab, value: event.target.value })} /></label>
          {tab === "employees" ? <label className="flex h-9 min-w-[220px] items-center gap-2 rounded-md border border-white/10 bg-black/45 px-3 text-white/40"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск сотрудника" aria-label="Поиск сотрудника" className="min-w-0 flex-1 border-0 bg-transparent p-0 text-xs text-white outline-none placeholder:text-white/35" /></label> : <div className="flex-1" />}
          <div className="flex items-center gap-3">
            <label className="flex h-9 items-center gap-2 rounded-md border border-white/10 bg-black/45 px-3"><span className="text-[10px] text-white/45">Город</span><select aria-label="Город показателей по магазинам" value={city} onChange={(event) => { setCity(event.target.value); setStoreId(""); }} className="max-w-[130px] border-0 bg-transparent p-0 text-xs text-white outline-none"><option value="">Все</option>{cities.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
            <label className="flex h-9 items-center gap-2 rounded-md border border-white/10 bg-black/45 px-3"><span className="text-[10px] text-white/45">Магазин</span><select aria-label="Магазин показателей по магазинам" value={storeId} onChange={(event) => setStoreId(event.target.value)} className="max-w-[150px] border-0 bg-transparent p-0 text-xs text-white outline-none"><option value="">Все</option>{availableStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
            {tab === "stores" && stores.length ? <button type="button" onClick={() => setQuickTaskOpen((value) => !value)} className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-semibold transition ${quickTaskOpen ? "border-brand/40 bg-brand/10 text-white" : "border-white/10 text-white/65 hover:border-brand/40 hover:text-white"}`}><Plus size={14} className="text-brand" />Быстрая задача</button> : null}
            <p className="text-[11px] text-white/40">{tab === "stores" ? `${filteredStores.length} магазинов · ${number.format(activeEmployees.length)} сотрудников с закрытыми сменами` : tab === "goals" ? `${filteredStores.length} магазинов · цели на ${formatMonth}` : `${number.format(visibleEmployees.length)} сотрудников`}</p>
          </div>
        </div>
        {quickTaskOpen && tab === "stores" ? <form action={`/tasks/create?returnTo=dashboard&period=${initialPeriod}`} method="post" className="grid shrink-0 gap-2 border-b border-white/8 bg-[#100c0d]/80 p-3 lg:grid-cols-[1.1fr_1.4fr_1.5fr_1fr_1.1fr_auto]">
          <input type="hidden" name="store_ids" value={taskStoreId} />
          <label className="grid gap-1 text-[10px] text-white/45"><span>Магазин</span><select required value={taskStoreId} onChange={(event) => setTaskStoreId(event.target.value)} className="h-9 min-w-0 rounded border border-white/10 bg-black/50 px-2 text-xs text-white">{stores.map((store) => <option key={store.id} value={store.id}>{store.city} · {store.name}</option>)}</select></label>
          <label className="grid gap-1 text-[10px] text-white/45"><span>Ответственный</span><select required name="assignee_employee_ids" defaultValue="" className="h-9 min-w-0 rounded border border-white/10 bg-black/50 px-2 text-xs text-white"><option value="" disabled>Выберите исполнителя</option><option value="__store_all__">На магазин: все менеджеры</option>{employeeMetrics.filter((employee) => employee.storeIds.includes(taskStoreId)).map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
          <label className="grid gap-1 text-[10px] text-white/45"><span>Название</span><input required name="title" maxLength={180} placeholder="Что нужно сделать" className="h-9 min-w-0 rounded border border-white/10 bg-black/50 px-2 text-xs text-white placeholder:text-white/30" /></label>
          <label className="grid gap-1 text-[10px] text-white/45"><span>Срок</span><input name="due_at" type="datetime-local" className="h-9 min-w-0 rounded border border-white/10 bg-black/50 px-2 text-xs text-white" /></label>
          <label className="grid gap-1 text-[10px] text-white/45"><span>Описание</span><input name="description" maxLength={2000} placeholder="Необязательно" className="h-9 min-w-0 rounded border border-white/10 bg-black/50 px-2 text-xs text-white placeholder:text-white/30" /></label>
          <div className="flex items-end"><button type="submit" disabled={!taskStoreId || !employeeMetrics.some((employee) => employee.storeIds.includes(taskStoreId))} className="h-9 w-full rounded-md bg-brand px-3 text-xs font-semibold text-white disabled:opacity-50">Создать</button></div>
        </form> : null}
        {tab === "goals" ? <GoalPlanner stores={filteredStores} period={initialPeriod} periods={periodChoices} /> : null}
        <div className={`min-h-0 flex-1 overflow-auto ${tab === "goals" ? "hidden" : ""}`}>
          {tab === "stores" ? <table className="w-full min-w-[1060px] border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 bg-[#100c0d] text-[10px] uppercase tracking-wide text-white/45"><tr>
              <th className="w-8 px-3 py-2" /><th className="px-2 py-2">Магазин</th><th className="px-2 py-2 text-right">Выручка</th><th className="px-2 py-2 text-right">Возвраты</th><th className="px-2 py-2 text-right">План</th><th className="px-2 py-2 text-right">Чеки</th><th className="px-2 py-2 text-right">Ср. чек</th><th className="px-2 py-2 text-right">Глубина</th><th className="px-2 py-2 text-right">Смены</th><th className="px-2 py-2 text-right">Команда</th><th className="px-2 py-2 text-right">Задачи</th><th className="px-2 py-2 text-right">Чек-листы</th><th className="px-3 py-2 text-right">Наличные</th>
            </tr></thead><tbody>
              {filteredStores.map((store) => <StoreTableRow key={store.id} store={store} allStores={storeMetrics} period={initialPeriod} expanded={expandedId === store.id} onToggle={() => setExpandedId(expandedId === store.id ? null : store.id)} employees={employeeMetrics.filter((employee) => employee.storeIds.includes(store.id))} />)}
              {!filteredStores.length ? <tr><td colSpan={13} className="px-4 py-10 text-center text-white/40">По выбранным фильтрам магазинов нет.</td></tr> : null}
            </tbody>
          </table> : <div className="flex flex-col gap-3 p-3">
            {filteredStores.map((store) => <EmployeeStoreGroup
              key={store.id}
              store={store}
              period={initialPeriod}
              employees={visibleEmployees.filter((employee) => employee.storeIds.includes(store.id) && (employee.byStore[store.id]?.shiftCount ?? 0) > 0)}
              expandedId={expandedId}
              onToggle={(id) => setExpandedId(expandedId === id ? null : id)}
            />)}
            {!filteredStores.length || !visibleEmployees.length ? <div className="rounded-md border border-white/8 px-4 py-10 text-center text-white/45">Сотрудников по выбранным фильтрам нет.</div> : null}
          </div>}
        </div>
      </section> : null}
    </div>
  </main>;
}

function StoreTableRow({ store, allStores, employees, period, expanded, onToggle }: {
  store: StoreMetric; allStores: StoreMetric[]; employees: EmployeeMetric[]; period: string; expanded: boolean; onToggle: () => void;
}) {
  const historical = store.monthlyHistory.find((month) => month.period === period && month.source === "cash-sheet");
  const revenue = historical?.revenue ?? store.netRevenue;
  const returns = historical?.returns ?? store.returns;
  const receipts = historical?.receipts ?? store.receipts;
  const averageCheck = historical ? historical.averageCheck : store.averageCheck;
  const checkDepth = historical ? historical.checkDepth : store.checkDepth;
  const netAfterReturns = historical ? historical.revenue - historical.returns : store.netRevenue;
  const completion = historical?.missingRevenue ? null : store.salesPlan && store.salesPlan > 0 ? revenue / store.salesPlan * 100 : store.planCompletion;
  const averageCheckAchieved = store.averageCheckTarget !== null && averageCheck !== null && Math.round(averageCheck * 100) / 100 >= store.averageCheckTarget;
  const checkDepthAchieved = store.checkDepthTarget !== null && checkDepth !== null && Math.round(checkDepth * 100) / 100 >= store.checkDepthTarget;
  return <>
    <tr className="border-b border-white/[0.055] transition hover:bg-white/[0.035]">
      <td className="px-2 py-2.5"><button type="button" aria-label={expanded ? `Свернуть ${store.name}` : `Показать подробности ${store.name}`} onClick={onToggle} className="grid size-6 place-items-center text-white/40 hover:text-white"><ChevronDown size={14} className={`transition-transform ${expanded ? "rotate-180" : ""}`} /></button></td>
      <td className="px-2 py-2.5"><div className="font-semibold">{store.name}</div><div className="mt-0.5 text-[10px] text-white/40">{store.city}</div></td>
      <td className="px-2 py-2.5 text-right font-semibold tabular-nums">{rubles(revenue)}{historical?.missingRevenue ? "*" : ""}</td><td className="px-2 py-2.5 text-right tabular-nums">{rubles(returns)}</td>
      <td className="min-w-[110px] px-2 py-2.5 text-right tabular-nums">{store.salesPlan === null ? <span className="text-white/35">—</span> : <><span>{pct(completion)}</span><Progress value={completion} tone={completion !== null && completion >= 100 ? "green" : "red"} /></>}</td>
      <td className="px-2 py-2.5 text-right tabular-nums">{number.format(receipts)}{historical?.missingReceipts ? "*" : ""}</td><td className={`px-2 py-2.5 text-right tabular-nums ${averageCheckAchieved ? "text-emerald-200" : ""}`}><div>{preciseRubles(averageCheck)}</div><div className="text-[10px] text-white/35">цель {preciseRubles(store.averageCheckTarget)}</div></td><td className={`px-2 py-2.5 text-right tabular-nums ${checkDepthAchieved ? "text-emerald-200" : ""}`}><div>{metric(checkDepth)}{historical?.missingItems ? "*" : ""}</div><div className="text-[10px] text-white/35">цель {metric(store.checkDepthTarget)}</div></td>
      <td className="px-2 py-2.5 text-right tabular-nums">{number.format(store.shiftCount)} <span className="text-white/35">/ {number.format(store.plannedShifts)}</span></td><td className="px-2 py-2.5 text-right tabular-nums">{number.format(store.employeeCount)}</td>
      <td className="px-2 py-2.5 text-right tabular-nums"><span className={store.taskOverdue ? "text-red-300" : ""}>{store.taskOpen} / {store.taskOverdue}</span><div className="text-[10px] text-white/35">откр. / проср.</div></td>
      <td className="px-2 py-2.5 text-right tabular-nums">{store.checklistAverage === null ? "—" : `${metric(store.checklistAverage)} · ${store.checklistCount}`}</td><td className="px-3 py-2.5 text-right tabular-nums">{rubles(store.cashAmount)}</td>
    </tr>
    {expanded ? <tr className="border-b border-white/8 bg-white/[0.025]"><td colSpan={13} className="px-5 py-3">
      <div className="grid gap-4 md:grid-cols-4">
        <Detail label="Выручка / после возвратов" value={`${rubles(revenue)} / ${rubles(netAfterReturns)}`} />
        <Detail label="Цели среднего чека / глубины" value={`${preciseRubles(store.averageCheckTarget)} / ${metric(store.checkDepthTarget)}`} />
        <Detail label="Выполнение целей" value={`Средний чек: ${store.averageCheckTarget === null ? "нет цели" : averageCheckAchieved ? "выполнен" : "не выполнен"} · глубина: ${store.checkDepthTarget === null ? "нет цели" : checkDepthAchieved ? "выполнена" : "не выполнена"}`} />
        <Detail label="Задачи выполнены в срок" value={store.taskDueCount ? `${number.format(store.taskOnTime)} из ${number.format(store.taskDueCount)}` : "Нет задач со сроком в этом месяце"} />
        <Detail label="Плановые смены" value={`${store.plannedShifts} запланировано · ${store.shiftCount} закрыто`} />
        <Detail label="Последний пересчёт кассы" value={store.cashUpdatedAt ? new Date(store.cashUpdatedAt).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "Нет данных"} />
      </div>
      <section className="mt-4 overflow-hidden rounded-md border border-white/8 bg-black/25">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/8 px-3 py-2">
          <h3 className="text-xs font-semibold">Сравнение магазина · {period.slice(0, 4)} и {Number(period.slice(0, 4)) - 1}</h3>
          <p className="text-[10px] text-white/40">Выберите год через месяц дашборда: рядом показан тот же календарный месяц текущего и предыдущего года.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1640px] border-collapse text-left text-[11px]">
            <thead className="bg-white/[0.035] text-white/45">
              <tr><th rowSpan={2} className="sticky left-0 z-20 min-w-[95px] border-r border-white/10 bg-[#141011] px-3 py-2">Месяц</th><th colSpan={7} className="border-r border-white/10 px-2 py-2 text-center">{period.slice(0, 4)}</th><th colSpan={7} className="px-2 py-2 text-center">{Number(period.slice(0, 4)) - 1}</th></tr>
              <tr>{Array.from({ length: 2 }, (_, yearIndex) => <Fragment key={yearIndex}>{["Выручка", "Товары", "Чеки", "Средний чек", "Глубина", "План", "Сезонность"].map((label) => <th key={`${yearIndex}-${label}`} className={`min-w-[90px] px-2 py-2 text-right ${label === "Сезонность" ? "border-r border-white/10" : ""}`}>{label}</th>)}</Fragment>)}</tr>
            </thead>
            <tbody>{Array.from({ length: 12 }, (_, index) => {
              const monthNumber = String(index + 1).padStart(2, "0");
              const currentMonth = `${period.slice(0, 4)}-${monthNumber}`;
              const previousMonth = `${Number(period.slice(0, 4)) - 1}-${monthNumber}`;
              const rows = [currentMonth, previousMonth].map((month) => store.monthlyHistory.find((item) => item.period === month));
              const seasonalities = [currentMonth, previousMonth].map((month) => seasonalityForMonth(store, allStores, month));
              return <tr key={monthNumber} className={`border-t border-white/[0.05] ${currentMonth === period ? "bg-red-950/20" : ""}`}>
                <td className="sticky left-0 z-10 border-r border-white/10 bg-[#100c0d] px-3 py-2 font-medium capitalize">{monthShortName(currentMonth)}</td>
                {rows.map((row, yearIndex) => {
                  const seasonality = seasonalities[yearIndex];
                  return <Fragment key={yearIndex}>
                    <td title={row?.missingRevenue ? `Нет выручки за ${row.missingRevenue} рабоч. дн.` : undefined} className="px-2 py-2 text-right tabular-nums">{rubles(row?.revenue ?? null)}{row?.missingRevenue ? "*" : ""}</td>
                    <td title={row?.missingItems ? `Нет количества товаров за ${row.missingItems} ${row.missingItemsUnit}` : undefined} className="px-2 py-2 text-right tabular-nums">{row?.itemsSold === null || !row ? "—" : number.format(row.itemsSold)}{row?.missingItems ? "*" : ""}</td>
                    <td title={row?.missingReceipts ? `Нет числа чеков за ${row.missingReceipts} рабочих дн.` : undefined} className="px-2 py-2 text-right tabular-nums">{row ? number.format(row.receipts) : "—"}{row?.missingReceipts ? "*" : ""}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{row ? rubles(row.averageCheck) : "—"}{row && (row.missingRevenue || row.missingReceipts) ? "*" : ""}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{row ? metric(row.checkDepth) : "—"}{row && (row.missingItems || row.missingReceipts) ? "*" : ""}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{row ? rubles(row.salesPlan) : "—"}</td>
                    <td title={seasonality.reference ? `Сезонность по ${seasonality.fallback ? "Ленинградской" : store.name}, ${seasonality.reference} г.${seasonality.fallback ? " (для магазина нет данных за предыдущий год)" : ""}` : undefined} className={`px-3 py-2 text-right tabular-nums ${yearIndex === 0 ? "border-r border-white/10" : ""}`}>{seasonality.value === null ? "—" : `${metric(seasonality.value, 3)}×`}{seasonality.fallback && seasonality.value !== null ? "*" : ""}</td>
                  </Fragment>;
                })}
              </tr>;
            })}</tbody>
          </table>
        </div>
        <p className="border-t border-white/8 px-3 py-2 text-[10px] text-white/40">Сезонность: выручка соответствующего месяца предыдущего года / средняя месячная выручка этого года по месяцам работы магазина. Если нет данных по нужному месяцу, используется Ленинградская (*). Пропуски в чеках и товарах отмечены звёздочкой; они считаются как 0.</p>
      </section>
      <form action="/dashboard/goals/save" method="post" className="mt-4 grid gap-2 rounded-md border border-white/8 bg-black/25 p-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_auto]">
        <input type="hidden" name="store_id" value={store.id} /><input type="hidden" name="period" value={period} />
        <label className="grid gap-1 text-[10px] text-white/45"><span>План продаж, ₽ (0 — не задан)</span><input name="sales_plan_amount" type="number" min="0" step="0.01" defaultValue={store.salesPlan ?? 0} className="h-9 rounded border border-white/10 bg-black/50 px-2 text-xs text-white" /></label>
        <label className="grid gap-1 text-[10px] text-white/45"><span>Цель среднего чека, ₽</span><input name="average_check_target" type="number" min="0.01" step="0.01" defaultValue={store.averageCheckTarget ?? ""} placeholder="Не задана" className="h-9 rounded border border-white/10 bg-black/50 px-2 text-xs text-white placeholder:text-white/30" /></label>
        <label className="grid gap-1 text-[10px] text-white/45"><span>Цель длины чека</span><input name="check_depth_target" type="number" min="0.01" step="0.01" defaultValue={store.checkDepthTarget ?? ""} placeholder="Не задана" className="h-9 rounded border border-white/10 bg-black/50 px-2 text-xs text-white placeholder:text-white/30" /></label>
        <div className="flex items-end"><button type="submit" className="h-9 w-full rounded-md border border-brand/35 bg-brand/10 px-3 text-xs font-semibold text-white hover:bg-brand/15">Сохранить цели</button></div>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">{employees.sort((a, b) => b.participationRevenue - a.participationRevenue).map((employee) => <span key={employee.id} className="rounded-md border border-white/8 bg-black/30 px-2.5 py-1.5 text-[11px]">{employee.name}<span className="ml-2 text-white/40">{employee.shiftCount} см. · {rubles(employee.participationRevenue)}</span></span>)}{employees.length === 0 ? <span className="text-[11px] text-white/40">Сотрудники со сменами не найдены.</span> : null}</div>
      <div className="mt-3 flex gap-2"><Link className="text-[11px] text-red-300 hover:text-red-200" href={`/tasks?storeId=${store.id}`}>Задачи магазина →</Link><Link className="text-[11px] text-red-300 hover:text-red-200" href={`/admin/closed-shifts?storeId=${store.id}`}>Архив смен →</Link><Link className="text-[11px] text-red-300 hover:text-red-200" href={`/checklists?storeId=${store.id}`}>Чек-листы →</Link></div>
    </td></tr> : null}
  </>;
}

function EmployeeStoreGroup({ store, employees, period, expandedId, onToggle }: {
  store: StoreMetric; employees: EmployeeMetric[]; period: string; expandedId: string | null; onToggle: (id: string) => void;
}) {
  const [year, month] = period.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const historical = store.monthlyHistory.find((row) => row.period === period);
  const revenue = historical?.revenue ?? store.grossRevenue;
  const averageCheck = historical ? historical.averageCheck : store.averageCheck;
  const checkDepth = historical ? historical.checkDepth : store.checkDepth;
  const salesPlan = historical?.salesPlan ?? store.salesPlan;
  return <section className="overflow-hidden rounded-lg border border-white/10 bg-[#0b0809]/90">
    <header className="grid gap-3 border-b border-white/8 bg-[#100c0d]/75 px-4 py-3 lg:grid-cols-[minmax(180px,1.2fr)_repeat(4,minmax(120px,1fr))] lg:items-center">
      <div><h3 className="flex items-center gap-2 text-base font-semibold"><Store size={16} className="text-brand" />{store.name}</h3><p className="mt-0.5 text-xs text-white/50">{store.city} · {employees.length} сотрудников</p></div>
      <StoreSummary label="Выручка магазина" value={rubles(revenue)} hint={`план ${rubles(salesPlan)}`} />
      <StoreSummary label="План на день" value={salesPlan ? rubles(salesPlan / daysInMonth) : "—"} hint="месячный план / дни месяца" />
      <StoreSummary label="Средний чек" value={rubles(averageCheck)} hint={`цель ${rubles(store.averageCheckTarget)}`} />
      <StoreSummary label="Длина чека" value={metric(checkDepth)} hint={`цель ${metric(store.checkDepthTarget)}`} />
    </header>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1260px] border-collapse text-left text-xs">
        <thead className="bg-black/30 text-[11px] uppercase tracking-wide text-white/55"><tr>
          <th className="w-9 px-3 py-2" /><th className="px-2 py-2">Сотрудник</th><th className="px-2 py-2 text-right">Уровень</th><th className="px-2 py-2 text-right">Смены</th><th className="px-2 py-2 text-right">Часы</th><th className="px-2 py-2 text-right">Оборот</th><th className="px-2 py-2 text-right">Чеки</th><th className="px-2 py-2 text-right">Ср. чек</th><th className="px-2 py-2 text-right">Позиций / чек</th><th className="px-2 py-2 text-right">Задачи в срок</th><th className="px-2 py-2 text-right">Чек-листы</th><th className="px-3 py-2 text-right">ЗП за месяц</th>
        </tr></thead>
        <tbody>{employees.map((employee) => {
          const id = `${store.id}:${employee.id}`;
          return <EmployeeStoreRow key={employee.id} employee={employee} store={store} period={period} expanded={expandedId === id} onToggle={() => onToggle(id)} />;
        })}
        {!employees.length ? <tr><td colSpan={12} className="px-4 py-7 text-center text-white/45">Сотрудники магазина не найдены за выбранный период.</td></tr> : null}
        </tbody>
      </table>
    </div>
  </section>;
}

function StoreSummary({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <div className="min-w-0"><p className="text-xs text-white/45">{label}</p><p className="mt-0.5 truncate text-sm font-semibold tabular-nums text-white">{value}</p><p className="truncate text-[11px] text-white/35">{hint}</p></div>;
}

function EmployeeStoreRow({ employee, store, period, expanded, onToggle }: {
  employee: EmployeeMetric; store: StoreMetric; period: string; expanded: boolean; onToggle: () => void;
}) {
  const local = employee.byStore[store.id];
  const completion = local.taskDueCount ? local.taskOnTime / local.taskDueCount * 100 : null;
  const rowDepth = local.checkDepth;
  return <>
    <tr className="border-b border-white/[0.055] transition hover:bg-white/[0.035]">
      <td className="px-2 py-2"><button type="button" aria-label={expanded ? `Свернуть ${employee.name}` : `Подробности ${employee.name}`} onClick={onToggle} className="grid size-6 place-items-center text-white/45 hover:text-white"><ChevronDown size={14} className={`transition-transform ${expanded ? "rotate-180" : ""}`} /></button></td>
      <td className="px-2 py-2"><div className="font-semibold text-white">{employee.name}</div></td>
      <td className="px-2 py-2 text-right font-medium tabular-nums">{employee.level ? `Level ${employee.level}` : "—"}</td>
      <td className="px-2 py-2 text-right tabular-nums">{number.format(local.shiftCount)}</td><td className="px-2 py-2 text-right tabular-nums">{metric(local.confirmedHours, 1)} ч.</td>
      <td className="px-2 py-2 text-right font-medium tabular-nums">{rubles(local.netRevenue)}</td><td className="px-2 py-2 text-right tabular-nums">{number.format(local.receipts)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{rubles(local.averageCheck)}</td><td className="px-2 py-2 text-right tabular-nums">{metric(rowDepth)}</td>
      <td className={`px-2 py-2 text-right tabular-nums ${completion !== null && completion < 95 ? "text-red-300" : ""}`}>{local.taskDueCount ? `${pct(completion)} · ${local.taskOnTime}/${local.taskDueCount}` : "—"}</td>
      <td className="px-2 py-2 text-right tabular-nums">{local.checklistAverage === null ? "—" : `${metric(local.checklistAverage)} · ${local.checklistCount}`}</td>
      <td className="px-3 py-2 text-right font-semibold tabular-nums">{rubles(employee.payroll)}</td>
    </tr>
    {expanded ? <tr className="border-b border-white/8 bg-white/[0.025]"><td colSpan={12} className="px-5 py-3">
      <div className="grid gap-3 md:grid-cols-4">
        <Detail label="Смены / часы на этом магазине" value={`${local.shiftCount} / ${metric(local.confirmedHours, 1)} ч.`} />
        <Detail label="Оборот до возвратов / возвраты" value={`${rubles(local.grossRevenue)} / ${rubles(local.returns)}`} />
        <Detail label="Средний чек / позиций на чек" value={`${rubles(local.averageCheck)} / ${metric(rowDepth)}`} />
        <Detail label="Задачи этого магазина в срок" value={local.taskDueCount ? `${local.taskOnTime} из ${local.taskDueCount} · ${local.taskDone} выполнено` : "Нет задач со сроком"} />
        <Detail label="Проверки на этом магазине" value={local.checklistAverage === null ? "Нет проверок" : `${metric(local.checklistAverage)} из 10 · ${local.checklistCount}`} />
        <Detail label="Зарплата сотрудника за весь месяц" value={employee.payroll === null ? "Ведомость ещё не рассчитана" : rubles(employee.payroll)} />
      </div>
      {employee.payrollParts ? <div className="mt-3 grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Detail label="Продажи / премии" value={`${rubles(employee.payrollParts.sales)} / ${rubles(employee.payrollParts.bonus)}`} />
        <Detail label="Оклад / авансы / удержания" value={`${rubles(employee.payrollParts.base)} / ${rubles(employee.payrollParts.advances)} / ${rubles(employee.payrollParts.deductions)}`} />
        {employee.payrollParts.mode === "academy" ? <>
          <Detail label="Академия: часы / почасовая часть" value={`${metric(employee.payrollParts.paidHours, 1)} ч. / ${rubles(employee.payrollParts.hourly)}`} />
          <Detail label="Комиссия / задачи / чек-лист" value={`${rubles(employee.payrollParts.commission)} / ${rubles(employee.payrollParts.taskBonus)} / ${rubles(employee.payrollParts.checklistBonus)}`} />
          <Detail label="KPI / конкурс / пакеты" value={`${rubles(employee.payrollParts.commercialKpiBonus)} / ${rubles(employee.payrollParts.contestBonus)} / ${rubles(employee.payrollParts.networkPackage + employee.payrollParts.mentorshipPackage)}`} />
        </> : null}
      </div> : null}
      <form action={`/tasks/create?returnTo=dashboard&period=${period}`} method="post" className="mt-4 grid gap-2 rounded-md border border-white/8 bg-black/25 p-3 sm:grid-cols-[1fr_1.5fr_1fr_auto]">
        <input type="hidden" name="assignee_employee_id" value={employee.id} /><input type="hidden" name="store_ids" value={store.id} /><input type="hidden" name="priority" value="normal" />
        <label className="grid gap-1 text-xs text-white/55"><span>Задача для {employee.name}</span><input name="title" required maxLength={180} placeholder="Название" className="h-9 min-w-0 rounded border border-white/10 bg-black/50 px-2 text-xs text-white placeholder:text-white/30" /></label>
        <label className="grid gap-1 text-xs text-white/55"><span>Срок</span><input name="due_at" type="datetime-local" className="h-9 min-w-0 rounded border border-white/10 bg-black/50 px-2 text-xs text-white" /></label>
        <div className="flex items-end"><button type="submit" className="h-9 w-full rounded-md bg-brand px-3 text-xs font-semibold text-white">Поставить задачу</button></div>
      </form>
      <div className="mt-3 flex gap-3"><Link className="text-xs text-red-300 hover:text-red-200" href={`/payroll?period=${period}&employeeId=${employee.id}`}>Расчёт зарплаты →</Link><Link className="text-xs text-red-300 hover:text-red-200" href={`/tasks?employeeId=${employee.id}&storeId=${store.id}`}>Задачи →</Link><Link className="text-xs text-red-300 hover:text-red-200" href={`/checklists?storeId=${store.id}`}>Чек-листы магазина →</Link></div>
    </td></tr> : null}
  </>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[10px] text-white/40">{label}</p><p className="mt-1 text-xs font-medium">{value}</p></div>;
}

function QuickLink({ href, label, icon: Icon }: { href: string; label: string; icon: typeof Store }) {
  return <Link href={href} aria-label={label} title={label} className="grid size-9 place-items-center rounded-md text-white/50 transition hover:bg-white/5 hover:text-brand"><Icon size={16} /></Link>;
}
