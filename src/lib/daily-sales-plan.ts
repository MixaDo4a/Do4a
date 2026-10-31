export type DailySalesHistoryRow = {
  date: string;
  revenue: number;
  returns: number;
};

export type DailySalesActualRow = {
  date: string;
  netRevenue: number;
};

export type DailySalesPlan = {
  target: number;
  monthlyRemaining: number;
  basis: "history" | "schedule" | "calendar";
  years: number[];
};

const YEAR_WEIGHTS = [0.5, 0.3, 0.2] as const;

function daysInMonth(period: string) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dateForDay(period: string, day: number) {
  return `${period}-${String(day).padStart(2, "0")}`;
}

function weekday(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function monthSegment(day: number) {
  return Math.min(3, Math.floor((day - 1) / 7));
}

function normalized(values: number[]) {
  const total = values.reduce((sum, value) => sum + value, 0);
  return total > 0 ? values.map((value) => value / total) : values.map(() => 1 / values.length);
}

function profileForYear(period: string, targetDates: string[], rows: DailySalesHistoryRow[]) {
  const yearOffset = Number(period.slice(0, 4)) - Number(rows[0]?.date.slice(0, 4) ?? period.slice(0, 4));
  const monthValues = rows.map((row) => Math.max(0, row.revenue - row.returns));
  const averageDaily = monthValues.reduce((sum, value) => sum + value, 0) / monthValues.length;
  if (!averageDaily) return null;

  const weekdayTotals = Array.from({ length: 7 }, () => ({ total: 0, count: 0 }));
  const segmentTotals = Array.from({ length: 4 }, () => ({ total: 0, count: 0 }));
  rows.forEach((row, index) => {
    const day = Number(row.date.slice(8, 10));
    const weekdayBucket = weekdayTotals[weekday(row.date)];
    weekdayBucket.total += monthValues[index];
    weekdayBucket.count++;
    const segmentBucket = segmentTotals[monthSegment(day)];
    segmentBucket.total += monthValues[index];
    segmentBucket.count++;
  });

  const raw = targetDates.map((date) => {
    const day = Number(date.slice(8, 10));
    const weekdayBucket = weekdayTotals[weekday(date)];
    const segmentBucket = segmentTotals[monthSegment(day)];
    const weekdayFactor = weekdayBucket.count ? weekdayBucket.total / weekdayBucket.count / averageDaily : 1;
    const segmentFactor = segmentBucket.count ? segmentBucket.total / segmentBucket.count / averageDaily : 1;
    return Math.sqrt(Math.max(0, weekdayFactor) * Math.max(0, segmentFactor));
  });
  return { year: Number(rows[0].date.slice(0, 4)), weight: YEAR_WEIGHTS[yearOffset - 1] ?? 0, shares: normalized(raw) };
}

export function calculateDailySalesPlan(input: {
  period: string;
  targetDate: string;
  monthlyPlan: number;
  historicalRows: DailySalesHistoryRow[];
  actualRows: DailySalesActualRow[];
  scheduledDates?: string[];
}): DailySalesPlan {
  const { period, targetDate, monthlyPlan, historicalRows, actualRows } = input;
  const calendarDates = Array.from({ length: daysInMonth(period) }, (_, index) => dateForDay(period, index + 1));
  const historicalByYear = new Map<number, DailySalesHistoryRow[]>();
  for (const row of historicalRows) {
    const year = Number(row.date.slice(0, 4));
    const rows = historicalByYear.get(year) ?? [];
    rows.push(row);
    historicalByYear.set(year, rows);
  }

  const profiles = [1, 2, 3].flatMap((offset) => {
    const year = Number(period.slice(0, 4)) - offset;
    const rows = (historicalByYear.get(year) ?? []).sort((a, b) => a.date.localeCompare(b.date));
    const expectedDays = daysInMonth(`${year}-${period.slice(5, 7)}`);
    if (rows.length !== expectedDays) return [];
    const profile = profileForYear(period, calendarDates, rows);
    return profile && profile.weight > 0 ? [profile] : [];
  });

  let dates = calendarDates;
  let weights: number[];
  let basis: DailySalesPlan["basis"];
  if (profiles.length) {
    const totalProfileWeight = profiles.reduce((sum, profile) => sum + profile.weight, 0);
    weights = calendarDates.map((_, index) => profiles.reduce((sum, profile) => sum + profile.shares[index] * profile.weight / totalProfileWeight, 0));
    weights = normalized(weights);
    basis = "history";
  } else {
    const scheduled = [...new Set(input.scheduledDates ?? [])].filter((date) => date.startsWith(`${period}-`)).sort();
    dates = scheduled.length ? [...new Set([...scheduled, targetDate])].sort() : calendarDates;
    weights = dates.map(() => 1 / dates.length);
    basis = scheduled.length ? "schedule" : "calendar";
  }

  const startIndex = dates.findIndex((date) => date >= targetDate);
  const remainingDates = startIndex >= 0 ? dates.slice(startIndex) : [];
  const remainingWeights = startIndex >= 0 ? weights.slice(startIndex) : [];
  const targetWeight = remainingDates[0] === targetDate ? remainingWeights[0] : 0;
  const weightSum = remainingWeights.reduce((sum, value) => sum + value, 0);
  const actualBeforeDate = actualRows
    .filter((row) => row.date >= `${period}-01` && row.date < targetDate)
    .reduce((sum, row) => sum + row.netRevenue, 0);
  const monthlyRemaining = Math.max(0, monthlyPlan - actualBeforeDate);

  return {
    target: weightSum > 0 ? monthlyRemaining * targetWeight / weightSum : 0,
    monthlyRemaining,
    basis,
    years: profiles.map((profile) => profile.year),
  };
}
