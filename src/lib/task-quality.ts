export type PersonalTaskDeadline = {
  due_at: string | null;
  completed_at: string | null;
  status: string;
};

export type TaskQuality = {
  percentage: number | null;
  onTimeCount: number;
  totalCount: number;
};

export function getTaskQualityPeriod(now = new Date()) {
  const end = now.toISOString();
  const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return { start, end };
}

export function summarizeTaskQuality(tasks: PersonalTaskDeadline[]): TaskQuality {
  const eligible = tasks.filter((task) => task.status !== "cancelled" && task.due_at);
  const onTimeCount = eligible.filter((task) =>
    task.status === "done" &&
    task.completed_at !== null &&
    new Date(task.completed_at).getTime() <= new Date(task.due_at as string).getTime(),
  ).length;

  return {
    percentage: eligible.length ? Math.round((onTimeCount / eligible.length) * 100) : null,
    onTimeCount,
    totalCount: eligible.length,
  };
}

export function missedTaskDeadlines<T extends PersonalTaskDeadline>(tasks: T[]): T[] {
  return tasks.filter((task) => {
    if (!task.due_at || task.status === "cancelled") return false;
    if (task.status !== "done" || !task.completed_at) return true;
    return new Date(task.completed_at).getTime() > new Date(task.due_at).getTime();
  });
}
