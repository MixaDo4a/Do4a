export type CashCountRow = {
  line_amount: number | string | null;
};

export type ShiftCashReportRow = {
  cash_collection_amount: number | string | null;
  shift_cash_counts?: CashCountRow[] | null;
};

export type StoreCashShiftRow = {
  store_id: string;
  closed_at: string | null;
  shift_date: string;
  status: string;
  stores: { id: string; name: string; city: string } | null;
  shift_closing_reports: ShiftCashReportRow | ShiftCashReportRow[] | null;
};

function single<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export function cashCountTotal(report: ShiftCashReportRow | ShiftCashReportRow[] | null | undefined) {
  const singleReport = single(report);
  if (!singleReport?.shift_cash_counts?.length) {
    return 0;
  }

  return singleReport.shift_cash_counts.reduce((sum, row) => sum + Number(row.line_amount ?? 0), 0);
}

export function buildStoreCashBalances(rows: StoreCashShiftRow[]) {
  const sorted = [...rows].sort((left, right) => (right.closed_at ?? right.shift_date).localeCompare(left.closed_at ?? left.shift_date));
  const balanceByStore = new Map<
    string,
    {
      storeId: string;
      storeName: string;
      city: string;
      lastClosedAt: string | null;
      lastShiftDate: string;
      latestReportTotal: number;
      totalCollectionAmount: number;
      balance: number;
    }
  >();

  for (const row of sorted) {
    if (balanceByStore.has(row.store_id)) {
      continue;
    }

    const report = single(row.shift_closing_reports);
    const latestReportTotal = cashCountTotal(report);
    const totalCollectionAmount = Number(report?.cash_collection_amount ?? 0);

    balanceByStore.set(row.store_id, {
      storeId: row.store_id,
      storeName: row.stores?.name ?? "Магазин",
      city: row.stores?.city ?? "",
      lastClosedAt: row.closed_at,
      lastShiftDate: row.shift_date,
      latestReportTotal,
      totalCollectionAmount,
      balance: Math.max(latestReportTotal - totalCollectionAmount, 0),
    });
  }

  return Array.from(balanceByStore.values());
}
