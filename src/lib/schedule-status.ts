export const SCHEDULE_STATUS_OPTIONS = [
  { value: "planned", label: "Р1", title: "Продавец 1" },
  { value: "planned_secondary", label: "Р2", title: "Продавец 2" },
  { value: "day_off", label: "В", title: "Выходной" },
  { value: "sick_leave", label: "Б", title: "Больничный" },
  { value: "vacation", label: "О", title: "Отпуск" },
] as const;

export const scheduleStatusLabels: Record<string, string> = Object.fromEntries(
  SCHEDULE_STATUS_OPTIONS.map((option) => [option.value, option.label]),
);

export function scheduleStatusLabel(status: string | null | undefined) {
  if (!status) {
    return "—";
  }

  return scheduleStatusLabels[status] ?? status;
}

export function scheduleStatusBadgeClass(status: string | null | undefined) {
  switch (status) {
    case "planned":
      return "border-orange-500/80 bg-orange-500 text-white shadow-[0_0_14px_rgba(249,115,22,0.34)]";
    case "planned_secondary":
      return "border-yellow-300/90 bg-yellow-400 text-neutral-950 shadow-[0_0_14px_rgba(250,204,21,0.32)]";
    case "day_off":
      return "border-emerald-400/80 bg-emerald-500 text-white shadow-[0_0_14px_rgba(16,185,129,0.28)]";
    case "sick_leave":
      return "border-violet-400/85 bg-violet-500 text-white shadow-[0_0_14px_rgba(139,92,246,0.3)]";
    case "vacation":
      return "border-blue-400/85 bg-blue-500 text-white shadow-[0_0_14px_rgba(59,130,246,0.3)]";
    default:
      return "border-slate-300/70 bg-slate-200 text-slate-950";
  }
}
