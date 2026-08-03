export type TaskRecurrenceFrequency = "daily" | "weekly" | "monthly";

export const TASK_RECURRENCE_FREQUENCIES: TaskRecurrenceFrequency[] = ["daily", "weekly", "monthly"];

export function taskRecurrenceLabel(frequency: string | null | undefined) {
  switch (frequency) {
    case "daily":
      return "Каждый день";
    case "weekly":
      return "Каждую неделю";
    case "monthly":
      return "Каждый месяц";
    default:
      return frequency ?? "";
  }
}

export function advanceTaskRecurrenceRun(base: Date, frequency: TaskRecurrenceFrequency) {
  const next = new Date(base.getTime());

  switch (frequency) {
    case "daily":
      next.setUTCDate(next.getUTCDate() + 1);
      break;
    case "weekly":
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case "monthly":
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
  }

  return next;
}
