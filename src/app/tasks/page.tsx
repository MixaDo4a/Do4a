import { CheckCircle2, Clock, ListTodo, XCircle } from "lucide-react";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { SectionHeader } from "@/components/section-header";
import { getCurrentEmployeeId, getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES, TASK_CREATOR_ROLES } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { cleanText, employeeName } from "@/lib/display";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  due_at: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  status: "open" | "in_progress" | "done" | "overdue" | "cancelled";
  stores: { id: string; name: string } | null;
  employees: { id: string; full_name: string } | null;
  task_comments: { id: string; body: string; created_at: string }[];
};

type StoreRow = {
  id: string;
  name: string;
};

type EmployeeRow = {
  id: string;
  full_name: string;
  employee_store_assignments: { store_id: string }[];
};

type ProfileEmployeeRow = { id: string; employee_id: string | null };
type ProfileRoleRow = { profile_id: string; roles: { code: string } | null };

type PageProps = {
  searchParams: Promise<{ message?: string; detail?: string; storeId?: string; employeeId?: string; dateFrom?: string; dateTo?: string; status?: string }>;
};

const messageLabels: Record<string, string> = {
  "task-required": "Заполните обязательные поля.",
  "task-error": "Не удалось выполнить действие с задачей.",
  "task-done": "Задача выполнена.",
  "task-failed": "Задача помечена как невыполненная.",
  "task-created": "Задача создана.",
};

const priorityLabels: Record<TaskRow["priority"], string> = {
  low: "Низкий",
  normal: "Обычный",
  high: "Высокий",
  urgent: "Срочно",
};

const statusLabels: Record<TaskRow["status"], string> = {
  open: "Открыта",
  in_progress: "В работе",
  done: "Выполнена",
  overdue: "Не выполнена",
  cancelled: "Отменена",
};

function formatDue(value: string | null) {
  if (!value) {
    return "Без срока";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function TasksPage({ searchParams }: PageProps) {
  const { message, detail, storeId, employeeId: selectedEmployeeId, dateFrom, dateTo, status } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { roles } = await getCurrentRoleCodes();
  const { employeeId } = await getCurrentEmployeeId();
  const canCreateTask = hasAnyRole(roles, TASK_CREATOR_ROLES);
  const warehouseManagerOnly = roles.includes("warehouse_manager") && !hasAnyRole(roles, MANAGE_ROLES);
  const warehouseAssistantOnly = roles.includes("warehouse_assistant") && !hasAnyRole(roles, MANAGE_ROLES);
  const canSeeAllTasks = hasAnyRole(roles, MANAGE_ROLES) || warehouseManagerOnly;
  const accessibleStores = await getAccessibleStores();
  const accessibleStoreIds = accessibleStores.map((store) => store.id);

  const [tasksResult, employeesResult, profilesResult, userRolesResult] = await Promise.all([
    canSeeAllTasks
      ? (() => {
          let query = supabase
            .from("tasks")
            .select(
              "id, title, description, due_at, priority, status, stores(id, name), employees(id, full_name), task_comments(id, body, created_at)",
            )
            .in("store_id", accessibleStoreIds)
            .order("due_at", { ascending: true, nullsFirst: false })
            .order("created_at", { ascending: false });

          if (storeId) {
            query = query.eq("store_id", storeId);
          }
          if (selectedEmployeeId) {
            query = query.eq("assignee_employee_id", selectedEmployeeId);
          }
          if (dateFrom) {
            query = query.gte("due_at", `${dateFrom}T00:00:00`);
          }
          if (dateTo) {
            query = query.lte("due_at", `${dateTo}T23:59:59`);
          }
          if (status && ["open", "in_progress", "done", "overdue", "cancelled"].includes(status)) {
            query = query.eq("status", status);
          }

          return query.returns<TaskRow[]>();
        })()
      : employeeId
        ? supabase
            .from("tasks")
            .select(
              "id, title, description, due_at, priority, status, stores(id, name), employees(id, full_name), task_comments(id, body, created_at)",
            )
            .eq("assignee_employee_id", employeeId)
            .order("due_at", { ascending: true, nullsFirst: false })
            .order("created_at", { ascending: false })
            .returns<TaskRow[]>()
        : Promise.resolve({ data: [] as TaskRow[], error: null }),
    supabase
      .from("employees")
      .select("id, full_name, employee_store_assignments(store_id)")
      .eq("is_active", true)
      .order("full_name")
      .returns<EmployeeRow[]>(),
    supabase.from("profiles").select("id, employee_id").returns<ProfileEmployeeRow[]>(),
    supabase.from("user_roles").select("profile_id, roles(code)").is("revoked_at", null).returns<ProfileRoleRow[]>(),
  ]);

  if (tasksResult.error) {
    throw new Error(tasksResult.error.message);
  }

  if (employeesResult.error) {
    throw new Error(employeesResult.error.message);
  }
  if (profilesResult.error) {
    throw new Error(profilesResult.error.message);
  }
  if (userRolesResult.error) {
    throw new Error(userRolesResult.error.message);
  }

  const stores = accessibleStores.map((store) => ({ id: store.id, name: store.name }));
  const profileIdByEmployeeId = new Map(profilesResult.data.map((profile) => [profile.employee_id ?? "", profile.id]));
  const roleByProfileId = new Map(userRolesResult.data.map((row) => [row.profile_id, row.roles?.code ?? null]));
  const employeesInAccessibleStores = employeesResult.data.filter((employee) =>
    employee.employee_store_assignments.some((assignment) => accessibleStoreIds.includes(assignment.store_id)),
  );
  const taskAssignees = warehouseAssistantOnly
    ? employeesResult.data.filter((employee) => employee.id === employeeId)
    : warehouseManagerOnly
      ? employeesInAccessibleStores.filter((employee) => {
          const profileId = profileIdByEmployeeId.get(employee.id);
          return profileId ? roleByProfileId.get(profileId) === "warehouse_assistant" : false;
        })
      : employeesInAccessibleStores;

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-4xl">
        <SectionHeader icon={ListTodo} title="Задачи" showBack />

        {message ? (
          <p className="mt-4 ui-panel p-3 text-sm text-muted">
            {messageLabels[message] ?? message}
            {detail ? <span className="mt-1 block text-xs text-brand">{detail}</span> : null}
          </p>
        ) : null}

        {canSeeAllTasks ? (
          <section className="mt-4 ui-panel p-4">
            <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" method="get">
              <select className="h-11 rounded-md border border-line px-3" name="storeId" defaultValue={storeId ?? ""}>
                <option value="">Все магазины</option>
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
              <select className="h-11 rounded-md border border-line px-3" name="employeeId" defaultValue={selectedEmployeeId ?? ""}>
                <option value="">Все сотрудники</option>
                {taskAssignees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.full_name}
                  </option>
                ))}
              </select>
              <select className="h-11 rounded-md border border-line px-3" name="status" defaultValue={status ?? ""}>
                <option value="">Все статусы</option>
                <option value="done">Выполнена</option>
                <option value="open">Не выполнена</option>
                <option value="in_progress">В работе</option>
                <option value="overdue">Просроченная</option>
                <option value="cancelled">Отменена</option>
              </select>
              <input className="h-11 rounded-md border border-line px-3" name="dateFrom" type="date" defaultValue={dateFrom ?? ""} />
              <input className="h-11 rounded-md border border-line px-3" name="dateTo" type="date" defaultValue={dateTo ?? ""} />
              <button className="h-11 rounded-md bg-brand px-4 font-semibold text-white lg:col-span-4">Показать задачи</button>
            </form>
          </section>
        ) : null}

        {canCreateTask ? (
          <section className="mt-4 ui-panel p-4">
            <h2 className="font-semibold">Новая задача</h2>
            <form action="/tasks/create" className="mt-3 grid gap-3" method="post">
              <input
                className="h-11 rounded-md border border-line px-3 outline-none focus:border-brand"
                name="title"
                placeholder="Название"
              />
              <textarea
                className="min-h-20 rounded-md border border-line px-3 py-2 outline-none focus:border-brand"
                name="description"
                placeholder="Описание"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <select className="h-11 rounded-md border border-line px-3" name="store_id">
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </select>
                <select className="h-11 rounded-md border border-line px-3" name="assignee_employee_id">
                  {taskAssignees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.full_name}
                    </option>
                  ))}
                </select>
                <input className="h-11 rounded-md border border-line px-3" name="due_at" type="datetime-local" />
                <select className="h-11 rounded-md border border-line px-3" name="priority" defaultValue="normal">
                  <option value="low">Низкий</option>
                  <option value="normal">Обычный</option>
                  <option value="high">Высокий</option>
                  <option value="urgent">Срочно</option>
                </select>
              </div>
              {stores.length === 0 || taskAssignees.length === 0 ? (
                <p className="rounded-md bg-surface p-3 text-sm text-muted">
                  Для создания задачи нужен хотя бы один активный магазин и один активный сотрудник.
                </p>
              ) : null}
              <button
                className="h-11 rounded-md bg-brand px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={stores.length === 0 || taskAssignees.length === 0}
              >
                Создать задачу
              </button>
            </form>
          </section>
        ) : null}

        <div className="mt-4 grid gap-3">
          {tasksResult.data.length === 0 ? (
            <section className="ui-panel p-4 text-sm text-muted shadow-soft">
              Для вас задач пока нет.
            </section>
          ) : null}

          {tasksResult.data.map((task) => (
            <article key={task.id} className="ui-panel p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{cleanText(task.title, "Задача с поврежденным текстом")}</p>
                  <p className="mt-1 text-sm text-muted">
                    {task.stores?.name ?? "Магазин"} · {employeeName(task.employees)}
                  </p>
                  {task.description ? (
                    <p className="mt-2 text-sm text-muted">{cleanText(task.description, "Описание повреждено")}</p>
                  ) : null}
                </div>
                <span className="rounded-md bg-surface px-2 py-1 text-xs font-medium">
                  {priorityLabels[task.priority]}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap gap-3 text-sm text-muted">
                <span className="inline-flex items-center gap-1">
                  <Clock size={15} /> {formatDue(task.due_at)}
                </span>
                <span>{statusLabels[task.status]}</span>
              </div>

              {task.task_comments.length > 0 ? (
                <div className="mt-4 rounded-md bg-surface p-3 text-sm">
                  <p className="font-semibold">Комментарии</p>
                  <div className="mt-2 grid gap-2">
                    {task.task_comments.map((comment) => (
                      <p key={comment.id} className="text-muted">
                        {cleanText(comment.body, "Комментарий поврежден")}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}

              {task.status !== "done" && task.status !== "cancelled" ? (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <form action="/tasks/complete" method="post">
                    <input name="task_id" type="hidden" value={task.id} />
                    <button className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold">
                      <CheckCircle2 size={16} /> Выполнить
                    </button>
                  </form>
                  <form action="/tasks/fail" className="grid gap-2" method="post">
                    <input name="task_id" type="hidden" value={task.id} />
                    <input
                      className="h-10 rounded-md border border-line px-3 text-sm outline-none focus:border-brand"
                      name="comment"
                      placeholder="Причина, если не выполнена"
                    />
                    <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold">
                      <XCircle size={16} /> Не выполнена
                    </button>
                  </form>
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



