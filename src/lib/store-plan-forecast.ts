export type StorePlanObservation = {
  period: string;
  revenue: number;
  returns: number;
  receipts: number;
  itemsSold: number | null;
  activeDays: number;
  missingRevenue: number;
  missingReceipts: number;
  missingItems: number;
};

export type StorePlanForecast = {
  sales: number | null;
  averageCheck: number | null;
  checkDepth: number | null;
  salesBasis: string;
};

function median(values: number[]): number | null {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function netRevenue(row: StorePlanObservation) {
  return Math.max(0, row.revenue - row.returns);
}

function monthDays(period: string) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function salesTarget(
  storeName: string,
  period: string,
  observations: StorePlanObservation[],
): { value: number | null; basis: string } {
  const targetYear = Number(period.slice(0, 4));
  const targetMonth = Number(period.slice(5, 7));
  const priorPeriod = `${targetYear - 1}-${period.slice(5, 7)}`;
  const byPeriod = new Map(observations.map((row) => [row.period, row]));
  const priorMonth = byPeriod.get(priorPeriod);
  const currentComparable: StorePlanObservation[] = [];
  const previousComparable: StorePlanObservation[] = [];
  const currentPeriod = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Vladivostok", year: "numeric", month: "2-digit",
  }).format(new Date());
  const comparableKeys: string[] = [];
  if (targetYear === Number(currentPeriod.slice(0, 4)) || targetYear < Number(currentPeriod.slice(0, 4))) {
    const lastMonth = targetYear === Number(currentPeriod.slice(0, 4))
      ? Math.min(targetMonth - 1, Number(currentPeriod.slice(5, 7)))
      : targetMonth - 1;
    for (let month = 1; month <= lastMonth; month += 1) {
      comparableKeys.push(`${targetYear}-${String(month).padStart(2, "0")}`);
    }
  } else {
    const latestObserved = observations
      .filter((row) => row.period <= currentPeriod && row.period < period)
      .map((row) => row.period)
      .sort()
      .at(-1);
    if (latestObserved) {
      const [latestYear, latestMonth] = latestObserved.split("-").map(Number);
      for (let offset = 11; offset >= 0; offset -= 1) {
        const date = new Date(Date.UTC(latestYear, latestMonth - 1 - offset, 1));
        comparableKeys.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
      }
    }
  }

  for (const key of comparableKeys) {
    const current = byPeriod.get(key);
    const [year, month] = key.split("-").map(Number);
    const previousKey = `${year - 1}-${String(month).padStart(2, "0")}`;
    const previous = byPeriod.get(previousKey);
    if (!current || !previous || current.missingRevenue > 0 || previous.missingRevenue > 0) break;
    currentComparable.push(current);
    previousComparable.push(previous);
  }

  const priorYearRevenue = currentComparable.reduce((sum, row) => sum + netRevenue(row), 0);
  const comparisonRevenue = previousComparable.reduce((sum, row) => sum + netRevenue(row), 0);
  if (priorMonth && priorMonth.missingRevenue === 0 && currentComparable.length === comparableKeys.length && comparisonRevenue > 0) {
    const base = netRevenue(priorMonth) * priorYearRevenue / comparisonRevenue;
    const monthName = new Intl.DateTimeFormat("ru-RU", { month: "long", timeZone: "UTC" })
      .format(new Date(`${priorPeriod}-01T00:00:00Z`));
    const trendLabel = targetMonth >= 4
      ? `динамика янв.–${String(targetMonth - 1).padStart(2, "0")}`
      : `динамика последних 12 месяцев`;
    return { value: Math.round(base * 1.1), basis: `${monthName} ${targetYear - 1} × ${trendLabel} × 1,10` };
  }

  if (storeName.trim().toLocaleLowerCase("ru") === "урбан") {
    const recent = observations
      .filter((row) => row.period < period && row.missingRevenue === 0 && row.activeDays >= 20)
      .sort((a, b) => b.period.localeCompare(a.period))
      .slice(0, 2)
      .sort((a, b) => a.period.localeCompare(b.period));
    const latest = recent.at(-1);
    if (latest && latest.activeDays > 0) {
      let growth = 0;
      const previous = recent.length > 1 ? recent[0] : null;
      if (previous && previous.activeDays > 0) {
        const previousDaily = netRevenue(previous) / monthDays(previous.period);
        const latestDaily = netRevenue(latest) / monthDays(latest.period);
        if (previousDaily > 0) growth = Math.max(0, latestDaily / previousDaily - 1);
      }
      const base = netRevenue(latest) / monthDays(latest.period) * monthDays(period) * (1 + growth);
      return { value: Math.round(Math.max(500_000, base * 1.1)), basis: `Тренд последних полных месяцев × 1,10; минимум 500 000 ₽` };
    }
    return { value: 500_000, basis: "Минимальный план Урбана" };
  }

  return { value: null, basis: "Недостаточно сопоставимых данных" };
}

function kpiTarget(
  observations: StorePlanObservation[],
  period: string,
  field: "averageCheck" | "checkDepth",
): number | null {
  const targetYear = period.slice(0, 4);
  const priorRows = observations.filter((row) => row.period < period);
  const sameYearRows = priorRows.filter((row) => row.period.startsWith(`${targetYear}-`));
  const sourceRows = sameYearRows.length ? sameYearRows : priorRows;
  const recent = sourceRows
    .map((row) => {
      const receipts = row.receipts;
      if (receipts <= 0 || row.itemsSold === null) return null;
      return field === "averageCheck"
        ? netRevenue(row) / receipts
        : row.itemsSold! / receipts;
    })
    .filter((value): value is number => value !== null && value > 0)
    .slice(-3);
  const base = median(recent);
  return base === null ? null : Math.round(base * 1.01 * 100) / 100;
}

export function forecastStorePlan(
  storeName: string,
  period: string,
  observations: StorePlanObservation[],
): StorePlanForecast {
  const ordered = [...observations].sort((a, b) => a.period.localeCompare(b.period));
  const sales = salesTarget(storeName, period, ordered);
  return {
    sales: sales.value,
    averageCheck: kpiTarget(ordered, period, "averageCheck"),
    checkDepth: kpiTarget(ordered, period, "checkDepth"),
    salesBasis: sales.basis,
  };
}
