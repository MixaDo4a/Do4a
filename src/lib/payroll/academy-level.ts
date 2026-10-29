export type AcademyRankHistoryRow = {
  id: string;
  user_id: string;
  rank: number;
  confirmed_at: string;
  pay_effective_from: string;
  timezone_name: string;
};

export type AcademyPayLevel =
  | { status: "ready"; level: number; source: "history" | "legacy_floor" | "default"; history: AcademyRankHistoryRow | null }
  | { status: "ambiguous"; level: null; source: "none"; history: null };

const LEGACY_CUTOFF = "2026-11-01";

function localCreationDate(createdAt: string, timeZone: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid employee creation time");

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function assertPayrollMonthStart(periodMonth: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(periodMonth)) {
    throw new Error("Expected the first day of a payroll month");
  }
}

export function resolveAcademyPayLevel(
  history: AcademyRankHistoryRow[],
  periodMonth: string,
  employeeCreatedAt: string,
  employeeTimeZone: string,
): AcademyPayLevel {
  assertPayrollMonthStart(periodMonth);
  const hasLegacyFloor = periodMonth >= LEGACY_CUTOFF &&
    localCreationDate(employeeCreatedAt, employeeTimeZone) < LEGACY_CUTOFF;

  const effective = history
    .filter((row) => row.pay_effective_from <= periodMonth)
    .sort((a, b) =>
      b.pay_effective_from.localeCompare(a.pay_effective_from) ||
      b.confirmed_at.localeCompare(a.confirmed_at),
    );

  if (effective.length === 0) {
    return hasLegacyFloor
      ? { status: "ready", level: 4, source: "legacy_floor", history: null }
      : { status: "ready", level: 1, source: "default", history: null };
  }

  const latestDate = effective[0].pay_effective_from;
  const latest = effective.filter((row) => row.pay_effective_from === latestDate);
  if (latest.some((row) => row.rank !== latest[0].rank) || latest[0].rank < 1 || latest[0].rank > 10) {
    return { status: "ambiguous", level: null, source: "none", history: null };
  }

  if (hasLegacyFloor && latest[0].rank < 4) {
    return { status: "ready", level: 4, source: "legacy_floor", history: latest[0] };
  }
  return { status: "ready", level: latest[0].rank, source: "history", history: latest[0] };
}
