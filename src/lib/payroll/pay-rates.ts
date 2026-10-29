export type AcademyPayRate = {
  id: number;
  level: number;
  effective_from: string;
  hourly_rate: number;
  base_commission_percent: number;
  plan_commission_percent: number;
};

export function resolveAcademyPayRate(
  rows: AcademyPayRate[],
  level: number,
  periodMonth: string,
): AcademyPayRate | null {
  if (!Number.isInteger(level) || level < 1 || level > 10) throw new Error("Invalid Academy level");
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(periodMonth)) throw new Error("Invalid payroll month");

  return rows
    .filter((row) => row.level === level && row.effective_from <= periodMonth)
    .sort((a, b) =>
      b.effective_from.localeCompare(a.effective_from) || b.id - a.id,
    )[0] ?? null;
}
