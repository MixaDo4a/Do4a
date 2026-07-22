import { scheduleStatusBadgeClass, scheduleStatusLabel } from "@/lib/schedule-status";

type UpcomingScheduleItem = {
  id: string;
  shift_date: string;
  status: string;
  stores: { name: string; city: string } | null;
  employeeName: string;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    weekday: "short",
  }).format(new Date(`${value}T00:00:00Z`));
}

export function UpcomingScheduleList({ items }: { items: UpcomingScheduleItem[] }) {
  if (items.length === 0) {
    return <p className="rounded-md bg-surface p-3 text-sm text-muted">Ближайших смен в графике нет.</p>;
  }

  return (
    <div className="grid gap-2">
      {items.map((item) => (
        <div key={item.id} className="rounded-md border border-line bg-surface p-3 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold">{formatDate(item.shift_date)}</p>
              <p className="mt-1 text-muted">
                {item.stores?.name ?? "Магазин"}
                {item.stores?.city ? `, ${item.stores.city}` : ""}
              </p>
              <p className="mt-1 text-muted">{item.employeeName}</p>
            </div>
            <span className={`rounded-lg border px-2 py-1 text-xs font-black ${scheduleStatusBadgeClass(item.status)}`}>
              {scheduleStatusLabel(item.status)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
