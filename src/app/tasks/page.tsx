import { CheckCircle2, ChevronDown, Clock, ListTodo, XCircle } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { SectionHeader } from "@/components/section-header";
import { TaskCreateForm } from "@/components/task-create-form";
import { PhotoFileInput } from "@/components/photo-file-input";
import {
  getCurrentEmployeeId,
  getCurrentRoleCodes,
  hasAnyRole,
  MANAGE_ROLES,
  RoleRelation,
  roleCodeFromRelation,
  TASK_CREATOR_ROLES,
} from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { cleanText } from "@/lib/display";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatStoreDateTime } from "@/lib/timezone";

type TaskRow = {
  id: string;
  recurrence_rule_id: string | null;
  requires_completion_photo: boolean;
  created_by: string | null;
  task_type: "ordinary" | "expiration_store" | "expiration_checker" | "expiration_marketer";
  expiration_campaign_id: string | null;
  completion_outcome: "sold_out" | "writeoff" | "distributed" | null;
  completion_comment: string | null;
  title: string;
  description: string | null;
  created_at: string;
  due_at: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  status: "open" | "in_progress" | "done" | "overdue" | "cancelled";
  stores: { id: string; name: string; timezone: string | null } | null;
  employees: { id: string; full_name: string } | null;
  task_comments: { id: string; body: string; created_at: string }[];
};

type EmployeeRow = {
  id: string;
  full_name: string;
  employee_store_assignments: { store_id: string; valid_from: string; valid_to: string | null }[];
};

type ProfileRoleRow = { profile_id: string; roles: RoleRelation };
type CampaignRow = { id: string; product_name: string; expiry_date: string; discount_type: "percent" | "new_price"; discount_value: number };
type SubtaskRow = { id: string; task_id: string; title: string; instructions: string; is_required: boolean; status: "open" | "done"; completed_by: string | null; completed_at: string | null };

type PageProps = {
  searchParams: Promise<{
    message?: string;
    detail?: string;
    storeId?: string;
    employeeId?: string;
    taskId?: string;
    dateFrom?: string;
    dateTo?: string;
    status?: string;
    deadline?: string;
  }>;
};

const messageLabels: Record<string, string> = {
  "task-required": "Заполните обязательные поля.",
  "task-error": "Не удалось выполнить действие с задачей.",
  "task-done": "Задача выполнена.",
  "task-failed": "Задача помечена как невыполненная.",
  "task-created": "Задача создана.",
  "task-reopened": "Подзадача возобновлена.",
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

const activeTaskStatuses: TaskRow["status"][] = ["open", "in_progress", "overdue"];

function formatDue(value: string | null, timeZone?: string | null) {
  if (!value) {
    return "Бессрочная";
  }

  return formatStoreDateTime(value, timeZone);
}

function buildTasksQuery(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  return supabase
    .from("tasks")
    .select(
      "id, recurrence_rule_id, requires_completion_photo, created_by, task_type, expiration_campaign_id, completion_outcome, completion_comment, title, description, created_at, due_at, priority, status, stores(id, name, timezone), employees(id, full_name), task_comments(id, body, created_at)",
    )
    .in("status", activeTaskStatuses)
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
}

export default async function TasksPage({ searchParams }: PageProps) {
  const { message, detail, storeId, employeeId: selectedEmployeeId, taskId, dateFrom, dateTo, status, deadline } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [{ roles }, { employeeId }] = await Promise.all([
    getCurrentRoleCodes(supabase, user),
    getCurrentEmployeeId(supabase, user),
  ]);
  const managerOnly = roles.includes("manager") && !roles.some((role) => ["store_manager", "super_admin", "developer"].includes(role));
  const canCreateTask = hasAnyRole(roles, TASK_CREATOR_ROLES);
  const warehouseManagerOnly = roles.includes("warehouse_manager") && !hasAnyRole(roles, MANAGE_ROLES);
  const warehouseAssistantOnly = roles.includes("warehouse_assistant") && !hasAnyRole(roles, MANAGE_ROLES);
  const accessibleStores = await getAccessibleStores(supabase);
  const accessibleStoreIds = accessibleStores.map((store) => store.id);
  const canSeeAllTasks = hasAnyRole(roles, MANAGE_ROLES) || warehouseManagerOnly || managerOnly || accessibleStoreIds.length > 0;
  const [tasksResult, employeesResult, profilesResult, userRolesResult] = await Promise.all([
    canSeeAllTasks
      ? (() => {
          let query = buildTasksQuery(supabase).in("store_id", accessibleStoreIds);

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
          if (deadline === "no_date") {
            query = query.is("due_at", null);
          }
          if (deadline === "has_date") {
            query = query.not("due_at", "is", null);
          }

          return query;
        })()
      : employeeId
        ? buildTasksQuery(supabase).eq("assignee_employee_id", employeeId)
        : Promise.resolve({ data: [] as TaskRow[], error: null }),
    supabase
      .from("employees")
      .select("id, full_name, employee_store_assignments(store_id,valid_from,valid_to)")
      .eq("is_active", true)
      .order("full_name"),
    supabase.from("profiles").select("id, employee_id"),
    supabase.from("user_roles").select("profile_id, roles(code)").is("revoked_at", null),
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

  const tasks = (tasksResult.data ?? []) as unknown as TaskRow[];
  const { data: warehouseFlags, error: warehouseFlagsError } = accessibleStoreIds.length
    ? await supabase.from("stores").select("id,is_warehouse").in("id", accessibleStoreIds).returns<{ id: string; is_warehouse: boolean }[]>()
    : { data: [] as { id: string; is_warehouse: boolean }[], error: null };
  if (warehouseFlagsError) throw new Error(warehouseFlagsError.message);
  const isWarehouseByStoreId = new Map((warehouseFlags ?? []).map((row) => [row.id, row.is_warehouse]));
  const stores = accessibleStores.map((store) => ({ id: store.id, name: store.name, isWarehouse: isWarehouseByStoreId.get(store.id) ?? /^склад\b/i.test(store.name) }));
  const profileIdByEmployeeId = new Map(profilesResult.data.map((profile) => [profile.employee_id ?? "", profile.id]));
  const rolesByProfileId = new Map<string, string[]>();
  for (const row of userRolesResult.data as ProfileRoleRow[]) {
    const role = roleCodeFromRelation(row.roles);
    if (!role) continue;
    const existing = rolesByProfileId.get(row.profile_id) ?? [];
    if (!existing.includes(role)) existing.push(role);
    rolesByProfileId.set(row.profile_id, existing);
  }
  const employeeRoles = new Map<string, string[]>();
  for (const [profileId, codes] of rolesByProfileId) {
    const employee = profilesResult.data.find((profile) => profile.id === profileId)?.employee_id;
    if (employee) employeeRoles.set(employee, codes);
  }
  const today = new Date().toISOString().slice(0, 10);
  const employeesInAccessibleStores = (employeesResult.data as EmployeeRow[]).filter((employee) =>
    employee.employee_store_assignments.some((assignment) => accessibleStoreIds.includes(assignment.store_id)
      && assignment.valid_from <= today && (!assignment.valid_to || assignment.valid_to >= today)),
  );
  const taskAssignees = warehouseAssistantOnly
    ? (employeesResult.data as EmployeeRow[]).filter((employee) => employee.id === employeeId)
    : warehouseManagerOnly
      ? employeesInAccessibleStores.filter((employee) => {
          const profileId = profileIdByEmployeeId.get(employee.id);
          return profileId ? rolesByProfileId.get(profileId)?.includes("warehouse_assistant") ?? false : false;
        })
      : employeesInAccessibleStores;

  const campaignAssignees = employeesInAccessibleStores.map((employee) => ({ id: employee.id, name: employee.full_name, roles: employeeRoles.get(employee.id) ?? [] }));
  const normalAssignees = taskAssignees.map((employee) => ({ id: employee.id, name: employee.full_name, roles: employeeRoles.get(employee.id) ?? [] }));
  const assigneeById = new Map([...campaignAssignees, ...normalAssignees].map((employee) => [employee.id, employee]));
  const createFormEmployees = [...assigneeById.values()];
  const campaignIds = [...new Set(tasks.map((task) => task.expiration_campaign_id).filter((id): id is string => Boolean(id)))];
  const taskIds = tasks.map((task) => task.id);
  const [campaignResult, subtasksResult] = await Promise.all([
    campaignIds.length ? supabase.from("expiration_campaigns").select("id,product_name,expiry_date,discount_type,discount_value").in("id", campaignIds).returns<CampaignRow[]>() : Promise.resolve({ data: [] as CampaignRow[], error: null }),
    taskIds.length ? supabase.from("task_subtasks").select("id,task_id,title,instructions,is_required,status,completed_by,completed_at").in("task_id", taskIds).order("sort_order").returns<SubtaskRow[]>() : Promise.resolve({ data: [] as SubtaskRow[], error: null }),
  ]);
  if (campaignResult.error) throw new Error(campaignResult.error.message);
  if (subtasksResult.error) throw new Error(subtasksResult.error.message);
  const campaignById = new Map((campaignResult.data ?? []).map((campaign) => [campaign.id, campaign]));
  const subtasksByTaskId = new Map<string, SubtaskRow[]>();
  for (const subtask of subtasksResult.data ?? []) {
    const items = subtasksByTaskId.get(subtask.task_id) ?? [];
    items.push(subtask);
    subtasksByTaskId.set(subtask.task_id, items);
  }

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

        <div className="mt-4 flex items-center justify-between gap-3">
          <Link className="inline-flex min-w-0 flex-1 items-center justify-center gap-2 rounded-md border border-brand/30 bg-brand/10 px-2 text-center text-xs font-semibold text-brand transition hover:border-brand/60 hover:bg-brand/15 sm:px-4 sm:text-sm" href={storeId ? `/tasks/archive?storeId=${storeId}` : "/tasks/archive"}>
            Архив закрытых задач
          </Link>
          {canSeeAllTasks && storeId ? <Link className="inline-flex min-w-0 flex-1 items-center justify-center gap-2 rounded-md border border-brand/30 bg-brand/10 px-2 text-center text-xs font-semibold text-brand transition hover:border-brand/60 hover:bg-brand/15 sm:px-4 sm:text-sm" href={`/checklists?store_id=${storeId}`}>Архив чек-листов</Link> : null}
        </div>

        {canSeeAllTasks && (storeId || taskId || selectedEmployeeId) ? (
          <details className="mt-4 ui-panel p-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold">
              <span className="inline-flex items-center gap-2">
                <ChevronDown size={16} />
                Фильтры
              </span>
              <span className="text-xs font-normal text-muted">По магазину, сотруднику, статусу и датам</span>
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
              <select className="h-11 rounded-md border border-line px-3" name="employeeId" defaultValue={selectedEmployeeId ?? ""}>
                <option value="">Все сотрудники</option>
                {taskAssignees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.full_name}
                  </option>
                ))}
              </select>
              <select className="h-11 rounded-md border border-line px-3" name="status" defaultValue={status ?? ""}>
                <option value="">Любой статус</option>
                <option value="open">Открыта</option>
                <option value="in_progress">В работе</option>
                <option value="overdue">Не выполнена</option>
              </select>
              <select className="h-11 rounded-md border border-line px-3" name="deadline" defaultValue={deadline ?? ""}>
                <option value="">Любой срок</option>
                <option value="no_date">Бессрочная</option>
                <option value="has_date">С датой</option>
              </select>
              <input className="h-11 rounded-md border border-line px-3" name="dateFrom" type="date" defaultValue={dateFrom ?? ""} />
              <input className="h-11 rounded-md border border-line px-3" name="dateTo" type="date" defaultValue={dateTo ?? ""} />
              <button className="h-11 rounded-md bg-brand px-4 font-semibold text-white lg:col-span-4">Показать задачи</button>
            </form>
          </details>
        ) : null}

        {canCreateTask ? (
          <details className="mt-4 ui-panel p-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold">
              <span className="inline-flex items-center gap-2">
                <ChevronDown size={16} />
                Выставить задачу
              </span>
              <span className="text-xs font-normal text-muted">Создание задачи и повторений</span>
            </summary>
            <TaskCreateForm stores={stores} employees={createFormEmployees} />
          </details>
        ) : null}

        {canSeeAllTasks && !storeId && !taskId && !selectedEmployeeId ? (
          <section className="mt-4 ui-panel p-4">
            <h2 className="font-semibold">Магазины и подразделения</h2>
            <div className="mt-3 grid gap-2">
              {stores.map((store) => (
                <Link key={store.id} className="flex items-center justify-between rounded-md border border-line p-3 font-semibold" href={`/tasks?storeId=${store.id}`}>
                  <span>{store.name}</span>
                  <span className="text-sm text-muted">Открыть задачи</span>
                </Link>
              ))}
            </div>
            {employeeId ? (
              <Link className="mt-3 flex items-center justify-between rounded-md border border-brand/40 bg-brand/10 p-3 font-semibold text-brand" href={`/tasks?employeeId=${employeeId}`}>
                <span>Личные задачи</span>
                <span className="text-sm">Открыть</span>
              </Link>
            ) : null}
          </section>
        ) : null}

        {(!canSeeAllTasks || storeId || taskId || selectedEmployeeId) ? <div className="mt-4 grid gap-3">
          {tasks.length === 0 ? (
            <section className="ui-panel p-4 text-sm text-muted shadow-soft">Для вас задач пока нет.</section>
          ) : null}

          {tasks.map((task) => (
            <article id={task.id} key={task.id} className="ui-panel p-4">
              {(() => {
                const campaign = task.expiration_campaign_id ? campaignById.get(task.expiration_campaign_id) : null;
                const subtasks = subtasksByTaskId.get(task.id) ?? [];
                const discountLabel = campaign ? campaign.discount_type === "percent" ? `${campaign.discount_value}%` : `${new Intl.NumberFormat("ru-RU").format(campaign.discount_value)} ₽` : "";
                return <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{cleanText(task.title, "Задача")}</p>
                  <p className="mt-1 text-sm text-muted">
                    {cleanText(task.employees?.full_name, "не выбрано")} · {cleanText(task.stores?.name, "Магазин")}
                  </p>
                  {task.description ? <p className="mt-2 text-sm text-muted">{cleanText(task.description, "Описание")}</p> : null}
                  {campaign ? <div className="mt-3 rounded-md border border-brand/20 bg-brand/5 p-3 text-sm">
                    <p className="font-semibold">Сроковая акция · {campaign.product_name}</p>
                    <p className="mt-1 text-muted">Годен до {campaign.expiry_date.split("-").reverse().join(".")} · {campaign.discount_type === "percent" ? "Скидка" : "Цена акции"}: {discountLabel}</p>
                    {task.task_type === "expiration_marketer" ? <p className="mt-2 text-muted">Основная задача закроется автоматически после выполнения обеих обязательных подзадач.</p> : null}
                    {task.task_type === "expiration_checker" ? <p className="mt-2 text-muted">После распределения остатка по магазинам подтвердите выполнение с кратким комментарием.</p> : null}
                  </div> : null}
                </div>
                <div className="flex flex-col items-end gap-2">
                  {task.recurrence_rule_id ? (
                    <span className="rounded-md border border-brand/30 bg-brand/10 px-2 py-1 text-xs font-medium text-brand">
                      Повторяющаяся
                    </span>
                  ) : null}
                  <span className="rounded-md bg-surface px-2 py-1 text-xs font-medium">{priorityLabels[task.priority]}</span>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-3 text-sm text-muted">
                <span className="inline-flex items-center gap-1">
                  <Clock size={15} /> Поставлена: {formatStoreDateTime(task.created_at, task.stores?.timezone)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock size={15} /> {formatDue(task.due_at, task.stores?.timezone)}
                </span>
                <span>{statusLabels[task.status]}</span>
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

              {subtasks.length > 0 ? <section className="mt-4 grid gap-2">
                <h3 className="text-sm font-semibold">Подзадачи</h3>
                {subtasks.map((subtask) => <div key={subtask.id} className="rounded-md border border-line p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="text-sm font-medium">{subtask.title}</p>{subtask.instructions ? <p className="mt-1 text-xs text-muted">{subtask.instructions}</p> : null}</div>
                    <span className="shrink-0 text-xs text-muted">{subtask.status === "done" ? "Выполнена" : "Открыта"}</span>
                  </div>
                  {subtask.status === "open" && task.status !== "done" ? <form action="/tasks/subtasks/status" method="post" className="mt-2">
                    <input name="subtask_id" type="hidden" value={subtask.id} /><input name="status" type="hidden" value="done" />
                    <button className="inline-flex h-9 items-center justify-center rounded-md border border-line px-3 text-sm font-semibold">Отметить выполненной</button>
                  </form> : null}
                  {subtask.status === "done" && task.created_by === user.id ? <form action="/tasks/subtasks/status" method="post" className="mt-2 grid gap-2">
                    <input name="subtask_id" type="hidden" value={subtask.id} /><input name="status" type="hidden" value="open" />
                    <input className="h-10 rounded-md border border-line px-3 text-sm" name="comment" placeholder="Почему нужно переделать?" required />
                    <button className="h-9 rounded-md border border-line px-3 text-sm font-semibold">Возобновить подзадачу</button>
                  </form> : null}
                </div>)}
              </section> : null}

              {task.status !== "done" && task.status !== "cancelled" ? (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {task.task_type === "expiration_store" ? <>
                    <form action="/tasks/complete" method="post"><input name="task_id" type="hidden" value={task.id} /><input name="completion_outcome" type="hidden" value="sold_out" /><button className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold"><CheckCircle2 size={16} /> Весь товар распродан</button></form>
                    <form action="/tasks/complete" method="post" className="grid gap-2"><input name="task_id" type="hidden" value={task.id} /><input name="completion_outcome" type="hidden" value="writeoff" /><input className="h-10 rounded-md border border-line px-3 text-sm" name="completion_comment" placeholder="Какая часть товара останется к списанию" required /><button className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold"><CheckCircle2 size={16} /> Не всё продано, остаток списан</button></form>
                  </> : task.task_type === "expiration_checker" ? <form action="/tasks/complete" method="post" className="grid gap-2 sm:col-span-2"><input name="task_id" type="hidden" value={task.id} /><input name="completion_outcome" type="hidden" value="distributed" /><input className="h-10 rounded-md border border-line px-3 text-sm" name="completion_comment" placeholder="По каким магазинам распределён остаток" required /><button className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold"><CheckCircle2 size={16} /> Остатки распределены</button></form> : task.task_type === "ordinary" ? <form action="/tasks/complete" method="post" encType="multipart/form-data" className="grid gap-2"><input name="task_id" type="hidden" value={task.id} />{task.requires_completion_photo ? <PhotoFileInput accept="image/jpeg,image/png,image/webp" label="Прикрепить фото выполнения" name="completion_photo" required selectedLabel="Фото выполнения добавлено" /> : null}<button className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold"><CheckCircle2 size={16} /> Выполнить{task.requires_completion_photo ? " и приложить фото" : ""}</button></form> : null}
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
                </>;
              })()}
            </article>
          ))}
        </div> : null}
      </div>
      <BottomNav />
    </main>
  );
}
