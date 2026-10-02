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

type PageProps = { searchParams: Promise<{ employeeId?: string }> };
type EmployeeAccessRow = {
  id: string;
  full_name: string;
  city: string | null;
  is_active: boolean;
  employee_store_assignments: { store_id: string }[];
};
type TaskRow = PersonalTaskDeadline & {
  id: string;
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

export default async function TaskQualityPage({ searchParams }: PageProps) {
  const { employeeId: requestedEmployeeId } = await searchParams;
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
  if (!isSelf) {
    if (!hasAnyRole(roles, MANAGE_ROLES)) notFound();
    const [{ data: target }, accessibleStores, scope] = await Promise.all([
      supabase.from("employees")
        .select("id, full_name, city, is_active, employee_store_assignments(store_id)")
        .eq("id", targetEmployeeId)
        .maybeSingle<EmployeeAccessRow>(),
      getAccessibleStores(supabase),
      getCurrentEmployeeScope(),
    ]);
    if (!target || !target.is_active) notFound();
    const canSeeAll = scope.isDeveloper;
    const storeIds = new Set(accessibleStores.map((store) => store.id));
    const sharesAccessibleStore = target.employee_store_assignments.some((assignment) => storeIds.has(assignment.store_id));
    const sameCity = !scope.city || target.city?.trim().toLowerCase() === scope.city.trim().toLowerCase();
    if (!canSeeAll && (!sharesAccessibleStore || !sameCity)) notFound();
  }

  const { start, end } = getTaskQualityPeriod();
  const [{ data: targetEmployee }, { data: tasks, error }] = await Promise.all([
    supabase.from("employees").select("full_name").eq("id", targetEmployeeId).maybeSingle<{ full_name: string }>(),
    supabase.from("tasks")
      .select("id, title, description, due_at, completed_at, status, priority, stores(name, timezone)")
      .eq("assignee_employee_id", targetEmployeeId)
      .gte("due_at", start)
      .lte("due_at", end)
      .neq("status", "cancelled")
      .order("due_at", { ascending: true })
      .returns<TaskRow[]>(),
  ]);
  if (error) throw new Error(error.message);

  const missed = missedTaskDeadlines(tasks ?? []);
  const managerName = targetEmployee?.full_name ?? "Менеджер";

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-3xl">
        <SectionHeader icon={ListChecks} title="Задачи не в срок" showBack />
        <section className="mt-4 ui-panel p-4">
          <p className="font-semibold">{managerName}</p>
          <p className="mt-1 text-sm text-muted">За последние 30 дней · {missed.length} из {(tasks ?? []).length} задач не выполнены вовремя</p>
        </section>
        {missed.length ? (
          <div className="mt-4 grid gap-3">
            {missed.map((task) => (
              <article className="ui-panel p-4" key={task.id}>
                <h2 className="font-semibold">{task.title}</h2>
                {task.description ? <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{task.description}</p> : null}
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
                  <span>{task.stores?.name ?? "Магазин"}</span>
                  <span className="inline-flex items-center gap-1"><Clock3 size={14} /> Срок: {formatStoreDateTime(task.due_at, task.stores?.timezone)}</span>
                  {task.status === "done" && task.completed_at ? <span>Выполнена: {formatStoreDateTime(task.completed_at, task.stores?.timezone)}</span> : null}
                </div>
                <p className="mt-2 text-sm font-medium text-brand">{statusLabels[task.status] ?? "Не выполнена в срок"}</p>
              </article>
            ))}
          </div>
        ) : (
          <section className="mt-4 ui-panel p-4 text-sm text-muted">За последние 30 дней задач, выполненных с опозданием или оставшихся незакрытыми после срока, нет.</section>
        )}
        <Link className="mt-4 inline-flex text-sm font-semibold text-muted underline underline-offset-4 hover:text-ink" href={isSelf ? "/profile" : "/admin/employees"}>
          Назад
        </Link>
      </div>
      <BottomNav />
    </main>
  );
}
