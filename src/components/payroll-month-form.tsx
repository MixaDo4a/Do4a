import { Calculator } from "lucide-react";

type PayrollMonthFormProps = {
  month: string;
  canRecalculate: boolean;
  filters?: { city: string; storeId: string; employeeId: string };
};

export function PayrollMonthForm({ month, canRecalculate, filters }: PayrollMonthFormProps) {
  return (
    <div className="mt-4 grid gap-3 rounded-md border border-line bg-white p-4 shadow-soft sm:grid-cols-[1fr_auto]">
      <form action="/payroll" className="grid gap-3 sm:grid-cols-[1fr_auto]" method="get">
        {filters?.city ? <input name="city" type="hidden" value={filters.city} /> : null}
        {filters?.storeId ? <input name="storeId" type="hidden" value={filters.storeId} /> : null}
        {filters?.employeeId ? <input name="filterEmployeeId" type="hidden" value={filters.employeeId} /> : null}
        <label className="grid gap-1 text-sm">
          <span className="text-muted">Месяц начислений</span>
          <input className="h-11 rounded-md border border-line px-3 outline-none focus:border-brand" defaultValue={month} name="period" required type="month" />
        </label>
        <button className="h-11 self-end rounded-md border border-line px-4 font-semibold">Показать</button>
      </form>
      {canRecalculate ? (
        <form action="/payroll/calculate" className="self-end" method="post">
          <input name="period_month" type="hidden" value={month} />
          <button className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-brand px-4 font-semibold text-white">
            <Calculator size={18} /> Пересчитать
          </button>
        </form>
      ) : null}
    </div>
  );
}

