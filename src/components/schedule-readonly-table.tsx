type ScheduleDate = {
  date: string;
  day: string;
  weekday: string;
};

type ScheduleGroup = {
  store: { id: string; name: string; city: string } | null;
  rows: Map<string, { employeeId: string; employeeName: string; statuses: Map<string, string> }>;
};

const statusClasses: Record<string, string> = {
  planned: "bg-orange-500 text-white border-orange-600",
  planned_secondary: "bg-yellow-400 text-slate-950 border-yellow-500",
  day_off: "bg-green-500 text-white border-green-600",
  sick_leave: "bg-violet-500 text-white border-violet-600",
  vacation: "bg-blue-500 text-white border-blue-600",
};

const statusLabels: Record<string, string> = {
  planned: "Р1",
  planned_secondary: "Р2",
  day_off: "В",
  sick_leave: "Б",
  vacation: "О",
};

function statusLabel(status: string | null | undefined) {
  if (!status) return "—";
  return statusLabels[status] ?? status;
}

export function ScheduleReadonlyTable({ dates, groups }: { dates: ScheduleDate[]; groups: ScheduleGroup[] }) {
  if (groups.length === 0) {
    return <p className="rounded-md bg-surface p-3 text-sm text-muted">На этот месяц график не заполнен.</p>;
  }

  return (
    <div className="grid gap-4">
      {groups.map((group) => (
        <div key={group.store?.id ?? "store"} className="overflow-hidden rounded-md border border-line bg-surface p-3">
          <div className="mb-3">
            <p className="font-semibold">{group.store?.name ?? "Магазин"}</p>
            {group.store?.city ? <p className="text-xs text-muted">{group.store.city}</p> : null}
          </div>
          <div className="max-w-full overflow-x-auto">
            <table className="min-w-[1500px] table-fixed border-collapse text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 z-20 w-[190px] border border-line bg-white px-3 py-2 text-left">
                    Сотрудник
                  </th>
                  {dates.map((cell) => (
                    <th key={cell.date} className="w-[42px] border border-line bg-white px-1 py-2 text-center">
                      <div className="font-semibold">{cell.weekday}</div>
                      <div className="text-[11px] text-muted">{cell.day}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...group.rows.values()].map((employeeRow) => (
                  <tr key={`${group.store?.id ?? "store"}_${employeeRow.employeeId}`}>
                    <td className="sticky left-0 z-20 border border-line bg-white px-3 py-2 font-medium">
                      {employeeRow.employeeName}
                    </td>
                    {dates.map((cell) => {
                      const status = employeeRow.statuses.get(cell.date) ?? "";
                      return (
                        <td key={cell.date} className="border border-line px-1 py-2 text-center">
                          <span
                            className={`inline-flex min-w-8 items-center justify-center rounded border px-2 py-1 text-xs font-semibold ${
                              statusClasses[status] ?? "bg-slate-200 text-slate-950 border-slate-300"
                            }`}
                          >
                            {statusLabel(status)}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
