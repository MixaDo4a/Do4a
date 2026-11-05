export const DEFAULT_TIME_ZONE = "Asia/Vladivostok";

export const STORE_TIME_ZONES = [
  { value: "Asia/Vladivostok", label: "Владивосток (UTC+10)" },
  { value: "Asia/Yakutsk", label: "Якутск (UTC+9)" },
  { value: "Asia/Irkutsk", label: "Иркутск (UTC+8)" },
  { value: "Asia/Novosibirsk", label: "Новосибирск (UTC+7)" },
  { value: "Asia/Omsk", label: "Омск (UTC+6)" },
  { value: "Asia/Yekaterinburg", label: "Екатеринбург (UTC+5)" },
  { value: "Europe/Samara", label: "Самара (UTC+4)" },
  { value: "Europe/Moscow", label: "Москва (UTC+3)" },
  { value: "UTC", label: "UTC" },
] as const;

export function storeTimeZone(value: string | null | undefined) {
  return value || DEFAULT_TIME_ZONE;
}

export function formatStoreDateTime(value: string | null, timeZone?: string | null) {
  if (!value) return "—";

  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: storeTimeZone(timeZone),
  }).format(new Date(value));
}

export function formatStoreDateTimeLocalInput(value: string | null, timeZone?: string | null) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: storeTimeZone(timeZone),
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}`;
}

export function parseStoreDateTimeLocalInput(value: string, timeZone?: string | null) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let utc = target;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: storeTimeZone(timeZone),
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const fields = Object.fromEntries(formatter.formatToParts(new Date(utc)).map(({ type, value: part }) => [type, part]));
    const represented = Date.UTC(Number(fields.year), Number(fields.month) - 1, Number(fields.day), Number(fields.hour), Number(fields.minute));
    const correction = target - represented;
    utc += correction;
    if (correction === 0) return new Date(utc).toISOString();
  }
  return null;
}
