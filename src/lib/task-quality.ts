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

export type TaskCreditShift = {
  store_id: string;
  shift_date: string;
  status: string;
  is_erroneous: boolean;
  shift_participants: { employee_id: string }[];
};

type CreditedTask = {
  store_id: string;
  assignee_employee_id: string | null;
  created_at: string;
  due_at: string | null;
  stores: { timezone: string | null } | null;
};

function localDateAt(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

export function isTaskCreditedToEmployee(
  task: CreditedTask,
  employeeId: string,
  shifts: TaskCreditShift[],
): boolean {
  if (task.assignee_employee_id) return task.assignee_employee_id === employeeId;
  if (!task.due_at) return false;

  const timeZone = task.stores?.timezone || "Asia/Vladivostok";
  const createdLocalDate = localDateAt(task.created_at, timeZone);
  const dueLocalDate = localDateAt(task.due_at, timeZone);

  return shifts.some((shift) =>
    shift.store_id === task.store_id &&
    !shift.is_erroneous &&
    shift.status === "closed" &&
    shift.shift_date >= createdLocalDate &&
    shift.shift_date <= dueLocalDate &&
    shift.shift_participants.some((participant) => participant.employee_id === employeeId),
  );
}

export function getTaskQualityPeriod(now = new Date()) {
  const end = now.toISOString();
  const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return { start, end };
}

export function summarizeTaskQuality(tasks: PersonalTaskDeadline[]): TaskQuality {
  const eligible = tasks.filter((task) =>
    (task.status === "done" || task.status === "overdue") && task.due_at,
  );
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
    if (!task.due_at) return false;
    if (task.status === "overdue") return true;
    if (task.status !== "done") return false;
    if (!task.completed_at) return true;
    return new Date(task.completed_at).getTime() > new Date(task.due_at).getTime();
  });
}

export function qualifiesForMonthlyTaskBonus(tasks: PersonalTaskDeadline[]): boolean {
  const eligible = tasks.filter((task) => task.status !== "cancelled" && task.due_at);
  const onTimeCount = eligible.filter((task) =>
    task.status === "done" &&
    task.completed_at !== null &&
    new Date(task.completed_at).getTime() <= new Date(task.due_at as string).getTime(),
  ).length;
  return eligible.length === 0 || onTimeCount * 100 >= eligible.length * 95;
}
