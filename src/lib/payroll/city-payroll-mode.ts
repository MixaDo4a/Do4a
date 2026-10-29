export type CityPayrollMode = "legacy" | "academy";

export type CityPayrollModeRow = {
  city: string;
  effective_from: string;
  calculation_mode: CityPayrollMode;
  created_at: string;
  id?: number;
};

export function resolveCityPayrollMode(
  history: CityPayrollModeRow[],
  city: string,
  periodMonth: string,
): CityPayrollMode {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodMonth)) {
    throw new Error("Invalid payroll mode month");
  }
  const effectiveFrom = `${periodMonth}-01`;
  const applicable = history
    .filter((row) => row.city === city && row.effective_from <= effectiveFrom)
    .sort((left, right) =>
      right.effective_from.localeCompare(left.effective_from)
      || right.created_at.localeCompare(left.created_at)
      || (right.id ?? 0) - (left.id ?? 0),
    );
  return applicable[0]?.calculation_mode ?? "legacy";
}
