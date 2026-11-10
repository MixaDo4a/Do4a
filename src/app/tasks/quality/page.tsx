import { Clock3, ListChecks } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { SectionHeader } from "@/components/section-header";
import { getAccessibleStores, getCurrentEmployeeScope } from "@/lib/auth/stores";
import { getCurrentEmployeeId, getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatStoreDateTime } from "@/lib/timezone";
import { getTaskQualityPeriod, missedTaskDeadlines, type PersonalTaskDeadline } from "@/lib/task-quality";

type PageProps = { searchParams: Promise<{ employeeId?: string; storeId?: string; period?: string; filter?: string }> };
type EmployeeAccessRow = {
  id: string;
  full_name: string;
  city: string | null;
  is_active: boolean;
  employee_store_assignments: { store_id: string }[];
};
type TaskRow = PersonalTaskDeadline & {
  id: string;
  store_id: string;
  title: string;
  description: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  stores: { name: string; timezone: string | null } | null;
};

const statusLabels: Record<string, string> = {
  open: "Не выполнена",
  in_progress: "В работе, срок пропущен",
  overdue: "Не выполнена",
  done: "Выполнена с опозданием",
};

function localDateAt(value: string | null, timeZone: string | null | undefined) {
  if (!value) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || "Asia/Vladivostok",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

export default async function TaskQualityPage({ searchParams }: PageProps) {
  const { employeeId: requestedEmployeeId, storeId: requestedStoreId, period: requestedPeriod, filter: requestedFilter } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ roles }, { employeeId: currentEmployeeId }] = await Promise.all([
    getCurrentRoleCodes(supabase, user),
    getCurrentEmployeeId(supabase, user),
  ]);
  const targetEmployeeId = requestedEmployeeId || currentEmployeeId;
  if (!targetEmployeeId) notFound();

  const isSelf = targetEmployeeId === currentEmployeeId;
  const filter = requestedFilter === "unfinished" || requestedFilter === "completed_late" ? requestedFilter : "all";
  const period = requestedPeriod && /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedPeriod)
    ? requestedPeriod
    : null;
  const accessibleStores = requestedStoreId || !isSelf ? await getAccessibleStores(supabase) : [];
  const accessibleStoreIds = new Set(accessibleStores.map((store) => store.id));
  let targetStoreIds: Set<string> | null = null;
  if (!isSelf) {
    if (!hasAnyRole(roles, MANAGE_ROLES)) notFound();
    const [{ data: target }, scope] = await Promise.all([
      supabase.from("employees")
        .select("id, full_name, city, is_active, employee_store_assignments(store_id)")
        .eq("id", targetEmployeeId)
        .maybeSingle<EmployeeAccessRow>(),
      getCurrentEmployeeScope(),
    ]);
    if (!target || !target.is_active) notFound();
    targetStoreIds = new Set(target.employee_store_assignments.map((assignment) => assignment.store_id));
    const canSeeAll = scope.isDeveloper;
    const sharesAccessibleStore = target.employee_store_assignments.some((assignment) => accessibleStoreIds.has(assignment.store_id));
    const sameCity = !scope.city || target.city?.trim().toLowerCase() === scope.city.trim().toLowerCase();
    if (!canSeeAll && (!sharesAccessibleStore || !sameCity)) notFound();
  } else if (requestedStoreId) {
    const { data: assignments } = await supabase.from("employee_store_assignments")
      .select("store_id").eq("employee_id", targetEmployeeId).returns<{ store_id: string }[]>();
    targetStoreIds = new Set((assignments ?? []).map((assignment) => assignment.store_id));
  }
  if (requestedStoreId && (!accessibleStoreIds.has(requestedStoreId) || !targetStoreIds?.has(requestedStoreId))) notFound();

  const { start, end } = period
    ? {
      start: new Date(Date.parse(`${period}-01T00:00:00.000Z`) - 86_400_000).toISOString(),
      end: new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 1) + 86_400_000).toISOString(),
    }
    : getTaskQualityPeriod();
  let taskQuery = supabase.from("tasks")
    .select("id, store_id, title, description, due_at, completed_at, status, priority, stores(name, timezone)")
    .eq("assignee_employee_id", targetEmployeeId)
    .gte("due_at", start)
    .lt("due_at", end)
    .neq("status", "cancelled");
  if (requestedStoreId) taskQuery = taskQuery.eq("store_id", requestedStoreId);
  const [{ data: targetEmployee }, { data: tasks, error }] = await Promise.all([
    supabase.from("employees").select("full_name").eq("id", targetEmployeeId).maybeSingle<{ full_name: string }>(),
    taskQuery.order("due_at", { ascending: true }).returns<TaskRow[]>(),
  ]);
  if (error) throw new Error(error.message);

  const missed = missedTaskDeadlines(tasks ?? []).filter((task) =>
    !period || localDateAt(task.due_at, task.stores?.timezone)?.startsWith(period),
  );
  const visibleMissed = missed.filter((task) =>
    filter === "unfinished" ? task.status !== "done" : filter === "completed_late" ? task.status === "done" : true,
  );
  const managerName = targetEmployee?.full_name ?? "Менеджер";

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-3xl">
        <SectionHeader icon={ListChecks} title="Задачи не в срок" showBack />
        <section className="mt-4 ui-panel p-4">
          <p className="font-semibold">{managerName}</p>
          <p className="mt-1 text-sm text-muted">{period ? `За ${period}` : "За последние 30 дней"} · {missed.length} задач не выполнены в срок</p>
        </section>
        <form method="get" className="mt-4 flex flex-wrap items-end gap-3 ui-panel p-3">
          {!isSelf ? <input type="hidden" name="employeeId" value={targetEmployeeId} /> : null}
          {requestedStoreId ? <input type="hidden" name="storeId" value={requestedStoreId} /> : null}
          {period ? <input type="hidden" name="period" value={period} /> : null}
          <label className="grid gap-1 text-sm"><span className="text-muted">Показать</span><select name="filter" defaultValue={filter} className="h-10 rounded border border-line bg-surface px-3 text-ink">
            <option value="all">Все задачи не в срок ({missed.length})</option>
            <option value="unfinished">Не завершены к сроку ({missed.filter((task) => task.status !== "done").length})</option>
            <option value="completed_late">Завершены с опозданием ({missed.filter((task) => task.status === "done").length})</option>
          </select></label>
          <button type="submit" className="h-10 rounded bg-brand px-4 text-sm font-semibold text-white">Применить</button>
        </form>
        {visibleMissed.length ? (
          <div className="mt-4 grid gap-3">
            {visibleMissed.map((task) => (
              <article className="ui-panel p-4" key={task.id}>
                <h2 className="font-semibold">{task.title}</h2>
                {task.description ? <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{task.description}</p> : null}
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
                  <span>{task.stores?.name ?? "Магазин"}</span>
                  <span className="inline-flex items-center gap-1"><Clock3 size={14} /> Срок: {formatStoreDateTime(task.due_at, task.stores?.timezone)}</span>
                  {task.status === "done" && task.completed_at ? <span>Выполнена: {formatStoreDateTime(task.completed_at, task.stores?.timezone)}</span> : null}
                </div>
                <p className="mt-2 text-sm font-medium text-brand">
                  {task.status === "done" && !task.completed_at
                    ? "Выполнена, но время завершения не записано"
                    : statusLabels[task.status] ?? "Не выполнена в срок"}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <section className="mt-4 ui-panel p-4 text-sm text-muted">Для выбранного фильтра задач не найдено.</section>
        )}
        <Link className="mt-4 inline-flex text-sm font-semibold text-muted underline underline-offset-4 hover:text-ink" href={isSelf ? "/profile" : "/admin/employees"}>
          Назад
        </Link>
      </div>
      <BottomNav />
    </main>
  );
}
