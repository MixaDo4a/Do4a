import { Archive, ChevronDown, Clock, ListTodo } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { SectionHeader } from "@/components/section-header";
import { getAccessibleStores } from "@/lib/auth/stores";
import { getCurrentEmployeeId } from "@/lib/auth/roles";
import { cleanText, employeeName } from "@/lib/display";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  due_at: string | null;
  completed_at: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  status: "done" | "overdue" | "cancelled";
  stores: { id: string; name: string }[] | null;
  employees: { id: string; full_name: string }[] | null;
  task_comments: { id: string; body: string; created_at: string }[];
};

type PageProps = {
  searchParams: Promise<{
    message?: string;
    detail?: string;
    storeId?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
  }>;
};

const messageLabels: Record<string, string> = {
  "task-error": "Не удалось загрузить архив задач.",
};

const priorityLabels: Record<TaskRow["priority"], string> = {
  low: "Низкий",
  normal: "Обычный",
  high: "Высокий",
  urgent: "Срочно",
};

const statusLabels: Record<TaskRow["status"], string> = {
  done: "Выполнена",
  overdue: "Не выполнена",
  cancelled: "Отменена",
};

function formatDate(value: string | null) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function TasksArchivePage({ searchParams }: PageProps) {
  const { message, detail, storeId, status, dateFrom, dateTo } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { employeeId } = await getCurrentEmployeeId();
  const accessibleStores = await getAccessibleStores();
  const accessibleStoreIds = accessibleStores.map((store) => store.id);

  let query = supabase
    .from("tasks")
    .select("id, title, description, due_at, completed_at, priority, status, stores(id, name), employees(id, full_name), task_comments(id, body, created_at)")
    .eq("assignee_employee_id", employeeId)
    .in("status", ["done", "overdue", "cancelled"])
    .in("store_id", accessibleStoreIds)
    .order("completed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (storeId) {
    query = query.eq("store_id", storeId);
  }
  if (status && ["done", "overdue", "cancelled"].includes(status)) {
    query = query.eq("status", status);
  }
  if (dateFrom) {
    query = query.gte("completed_at", `${dateFrom}T00:00:00`);
  }
  if (dateTo) {
    query = query.lte("completed_at", `${dateTo}T23:59:59`);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  const tasks = (data ?? []) as unknown as TaskRow[];
  const stores = accessibleStores.map((store) => ({ id: store.id, name: store.name }));

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-4xl">
        <SectionHeader icon={Archive} title="Архив задач" showBack />

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Link className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-brand/30 bg-brand/10 px-4 text-sm font-semibold text-brand transition hover:border-brand/60 hover:bg-brand/15" href="/tasks">
            <ListTodo size={16} /> Активные задачи
          </Link>
        </div>

        {message ? (
          <p className="mt-4 ui-panel p-3 text-sm text-muted">
            {messageLabels[message] ?? message}
            {detail ? <span className="mt-1 block text-xs text-brand">{detail}</span> : null}
          </p>
        ) : null}

        <details className="mt-4 ui-panel p-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold">
            <span className="inline-flex items-center gap-2">
              <ChevronDown size={16} />
              Фильтры
            </span>
            <span className="text-xs font-normal text-muted">Магазин, статус и даты закрытия</span>
          </summary>
          <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" method="get">
            <select className="h-11 rounded-md border border-line px-3" name="storeId" defaultValue={storeId ?? ""}>
              <option value="">Все магазины</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
            <select className="h-11 rounded-md border border-line px-3" name="status" defaultValue={status ?? ""}>
              <option value="">Любой статус</option>
              <option value="done">Выполнена</option>
              <option value="overdue">Не выполнена</option>
              <option value="cancelled">Отменена</option>
            </select>
            <input className="h-11 rounded-md border border-line px-3" name="dateFrom" type="date" defaultValue={dateFrom ?? ""} />
            <input className="h-11 rounded-md border border-line px-3" name="dateTo" type="date" defaultValue={dateTo ?? ""} />
            <button className="h-11 rounded-md bg-brand px-4 font-semibold text-white lg:col-span-4">Показать архив</button>
          </form>
        </details>

        <div className="mt-4 grid gap-3">
          {tasks.length === 0 ? <section className="ui-panel p-4 text-sm text-muted shadow-soft">В архиве задач пока нет.</section> : null}

          {tasks.map((task) => (
            <article key={task.id} className="ui-panel p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{cleanText(task.title, "Задача")}</p>
                  <p className="mt-1 text-sm text-muted">
                    {task.stores?.[0]?.name ?? "Магазин"} · {employeeName(task.employees?.[0] ?? null)}
                  </p>
                  {task.description ? <p className="mt-2 text-sm text-muted">{cleanText(task.description, "Описание")}</p> : null}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="rounded-md bg-surface px-2 py-1 text-xs font-medium">{priorityLabels[task.priority]}</span>
                  <span className="rounded-md border border-brand/30 bg-brand/10 px-2 py-1 text-xs font-medium text-brand">{statusLabels[task.status]}</span>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-3 text-sm text-muted">
                <span className="inline-flex items-center gap-1">
                  <Clock size={15} /> Срок: {formatDate(task.due_at)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock size={15} /> Завершено: {formatDate(task.completed_at)}
                </span>
              </div>

              {task.task_comments.length > 0 ? (
                <div className="mt-4 rounded-md bg-surface p-3 text-sm">
                  <p className="font-semibold">Комментарии</p>
                  <div className="mt-2 grid gap-2">
                    {task.task_comments.map((comment) => (
                      <p key={comment.id} className="text-muted">
                        {cleanText(comment.body, "Комментарий")}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </div>
      <BottomNav />
    </main>
  );
}
