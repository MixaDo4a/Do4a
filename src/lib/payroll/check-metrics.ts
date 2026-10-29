export type ShiftCheckMetrics = {
  revenue: number;
  receiptCount: number;
  itemsSoldCount: number | null;
};

export type AggregatedCheckMetrics = {
  receiptCount: number;
  averageCheck: number | null;
  checkDepth: number | null;
};

export function aggregateCheckMetrics(shifts: ShiftCheckMetrics[]): AggregatedCheckMetrics {
  if (shifts.some((shift) =>
    !Number.isFinite(shift.revenue)
    || !Number.isInteger(shift.receiptCount) || shift.receiptCount < 0
    || (shift.itemsSoldCount !== null && (!Number.isInteger(shift.itemsSoldCount) || shift.itemsSoldCount < 0)))) {
    throw new Error("Invalid shift check metrics");
  }

  const receiptCount = shifts.reduce((sum, shift) => sum + shift.receiptCount, 0);
  const revenue = shifts.reduce((sum, shift) => sum + shift.revenue, 0);
  const itemsComplete = shifts.every((shift) => shift.itemsSoldCount !== null);
  const itemsSoldCount = shifts.reduce((sum, shift) => sum + (shift.itemsSoldCount ?? 0), 0);

  return {
    receiptCount,
    averageCheck: receiptCount > 0 ? revenue / receiptCount : null,
    checkDepth: receiptCount > 0 && itemsComplete ? itemsSoldCount / receiptCount : null,
  };
}
