export type StoreWorkWindow = {
  shiftDate: string;
  timeZone: string;
  workdayStartTime: string;
  workdayEndTime: string;
};

const HALF_HOUR_MS = 30 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function wallClockTimestamp(value: string, timeZone: string): number {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid work mark time");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const number = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(number("year"), number("month") - 1, number("day"), number("hour"), number("minute"), number("second"));
}

function windowTimestamp(date: string, time: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)) {
    throw new Error("Invalid store work window");
  }
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second = 0] = time.split(":").map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

export function calculatePaidShiftHours(
  startedAt: string,
  endedAt: string,
  store: StoreWorkWindow,
): number {
  const start = wallClockTimestamp(startedAt, store.timeZone);
  const end = wallClockTimestamp(endedAt, store.timeZone);
  if (end <= start) throw new Error("Work end must be after work start");

  const windowStart = windowTimestamp(store.shiftDate, store.workdayStartTime);
  let windowEnd = windowTimestamp(store.shiftDate, store.workdayEndTime);
  if (windowEnd <= windowStart) windowEnd += 24 * HOUR_MS;

  const overlap = Math.max(0, Math.min(end, windowEnd) - Math.max(start, windowStart));
  const roundedHours = Math.ceil(overlap / HALF_HOUR_MS) / 2;
  const maximumHours = (windowEnd - windowStart) / HOUR_MS;
  return Math.min(roundedHours, maximumHours);
}
