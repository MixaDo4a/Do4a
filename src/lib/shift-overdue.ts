import { storeTimeZone } from "@/lib/timezone";

export type ShiftDeadline = {
  shift_date: string;
  schedules: { planned_end_at: string } | null;
  stores: { timezone: string | null } | null;
};

export function isShiftOverdue(shift: ShiftDeadline, now = new Date()) {
  if (shift.schedules?.planned_end_at) {
    return new Date(shift.schedules.planned_end_at).getTime() < now.getTime();
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit",
    timeZone: storeTimeZone(shift.stores?.timezone),
  }).formatToParts(now);
  const today = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return shift.shift_date < `${today.year}-${today.month}-${today.day}`;
}
