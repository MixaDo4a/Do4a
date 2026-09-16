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
