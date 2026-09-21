import { scheduleStatusBadgeClass, scheduleStatusLabel } from "@/lib/schedule-status";

type ScheduleItem = {
  id: string;
  shift_date: string;
  status: string;
  stores: { id?: string; name: string; city?: string } | null;
  employeeName: string;
};

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "short" })
    .format(new Date(`${value}T00:00:00Z`));
}

export function StoreSchedulePreview({ items, today, tomorrow }: { items: ScheduleItem[]; today: string; tomorrow: string }) {
  const groups = new Map<string, { store: ScheduleItem["stores"]; employees: Map<string, { name: string; statuses: Map<string, string> }> }>();

  for (const item of items) {
    const storeKey = item.stores?.id ?? item.stores?.name ?? "store";
    const group = groups.get(storeKey) ?? { store: item.stores, employees: new Map() };
    const employee = group.employees.get(item.employeeName) ?? { name: item.employeeName, statuses: new Map<string, string>() };
    employee.statuses.set(item.shift_date, item.status);
    group.employees.set(item.employeeName, employee);
    groups.set(storeKey, group);
  }

  if (groups.size === 0) {
    return <p className="rounded-md bg-surface p-3 text-sm text-muted">Ближайших смен в графике нет.</p>;
  }

  const dates = [today, tomorrow];
  return (
    <div className="grid gap-3">
      {[...groups.values()].map((group, index) => (
        <section key={`${group.store?.id ?? group.store?.name ?? "store"}_${index}`} className="overflow-hidden rounded-md border border-line bg-surface p-3">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(150px,0.9fr)] gap-3 border-b border-line pb-2 text-xs font-semibold">
            <div>
              <p className="truncate text-sm">{group.store?.name ?? "Магазин"}</p>
              {group.store?.city ? <p className="mt-0.5 truncate font-normal text-muted">{group.store.city}</p> : null}
            </div>
            <div className="grid grid-cols-2 gap-2 text-center">
              {dates.map((date) => <span key={date}>{dateLabel(date)}</span>)}
            </div>
          </div>

          <div className="divide-y divide-line">
            {[...group.employees.values()].map((employee) => (
              <div key={employee.name} className="grid grid-cols-[minmax(0,1fr)_minmax(150px,0.9fr)] items-center gap-3 py-2 text-sm">
                <p className="truncate font-medium">{employee.name}</p>
                <div className="grid grid-cols-2 gap-2 text-center">
                  {dates.map((date) => {
                    const status = employee.statuses.get(date);
                    return status ? (
                      <span key={date} className={`rounded-md border px-1.5 py-1 text-[11px] font-black ${scheduleStatusBadgeClass(status)}`}>
                        {scheduleStatusLabel(status)}
                      </span>
                    ) : (
                      <span key={date} className="rounded-md border border-line px-1.5 py-1 text-[11px] text-muted">Выходной</span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
