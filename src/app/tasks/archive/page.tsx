import { Archive, ChevronDown, Clock, ListTodo } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { SectionHeader } from "@/components/section-header";
import { getAccessibleStores } from "@/lib/auth/stores";
import { getCurrentEmployeeId, getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { cleanText } from "@/lib/display";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatStoreDateTime } from "@/lib/timezone";

type TaskRow = {
  id: string;
  created_by: string | null;
  task_type: "ordinary" | "expiration_store" | "expiration_checker" | "expiration_marketer";
  expiration_campaign_id: string | null;
  completion_outcome: "sold_out" | "writeoff" | "distributed" | null;
  completion_comment: string | null;
  title: string;
  description: string | null;
  created_at: string;
  due_at: string | null;
  completed_at: string | null;
  requires_completion_photo: boolean;
  priority: "low" | "normal" | "high" | "urgent";
  status: "done" | "overdue" | "cancelled";
  stores: { id: string; name: string; timezone: string | null } | null;
  employees: { id: string; full_name: string } | null;
  task_comments: { id: string; body: string; created_at: string }[];
};
type CampaignRow = { id: string; product_name: string; expiry_date: string; discount_type: "percent" | "new_price"; discount_value: number };
type SubtaskRow = { id: string; task_id: string; title: string; instructions: string; status: "open" | "done" };
type CompletionPhotoRow = { task_id: string; storage_path: string | null; expires_at: string; deleted_at: string | null };

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

export default async function TasksArchivePage({ searchParams }: PageProps) {
  const { message, detail, storeId, status, dateFrom, dateTo } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [{ employeeId }, { roles }] = await Promise.all([
    getCurrentEmployeeId(supabase, user),
    getCurrentRoleCodes(supabase, user),
  ]);
  const accessibleStores = await getAccessibleStores(supabase);
  const accessibleStoreIds = accessibleStores.map((store) => store.id);
  const managerOnly = roles.includes("manager") && !hasAnyRole(roles, MANAGE_ROLES);
  const canSeeAllTasks = hasAnyRole(roles, MANAGE_ROLES) || managerOnly || accessibleStoreIds.length > 0;

  let query = supabase
    .from("tasks")
    .select("id, created_by, task_type, expiration_campaign_id, completion_outcome, completion_comment, title, description, created_at, due_at, completed_at, requires_completion_photo, priority, status, stores(id, name, timezone), employees(id, full_name), task_comments(id, body, created_at)")
    .in("status", ["done", "overdue", "cancelled"])
    .in("store_id", accessibleStoreIds)
    .order("completed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (!canSeeAllTasks && employeeId) {
    query = query.eq("assignee_employee_id", employeeId);
  }

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
  const campaignIds = [...new Set(tasks.map((task) => task.expiration_campaign_id).filter((id): id is string => Boolean(id)))];
  const taskIds = tasks.map((task) => task.id);
  const completedTaskIds = tasks.filter((task) => task.status === "done" && task.requires_completion_photo).map((task) => task.id);
  const [campaignResult, subtaskResult, photoResult] = await Promise.all([
    campaignIds.length
      ? supabase.from("expiration_campaigns").select("id,product_name,expiry_date,discount_type,discount_value").in("id", campaignIds).returns<CampaignRow[]>()
      : Promise.resolve({ data: [] as CampaignRow[], error: null }),
    taskIds.length
      ? supabase.from("task_subtasks").select("id,task_id,title,instructions,status").in("task_id", taskIds).order("sort_order").returns<SubtaskRow[]>()
      : Promise.resolve({ data: [] as SubtaskRow[], error: null }),
    completedTaskIds.length > 0
      ? supabase.from("task_completion_photos").select("task_id,storage_path,expires_at,deleted_at").in("task_id", completedTaskIds).returns<CompletionPhotoRow[]>()
      : Promise.resolve({ data: [] as CompletionPhotoRow[], error: null }),
  ]);
  if (campaignResult.error) throw new Error(campaignResult.error.message);
  if (subtaskResult.error) throw new Error(subtaskResult.error.message);
  if (photoResult.error) throw new Error(photoResult.error.message);
  const completionPhotoUrls = new Map<string, string>();
  const completionPhotoStates = new Map<string, "deleted" | "expired" | "unavailable">();
  await Promise.all((photoResult.data ?? []).map(async (photo) => {
    if (photo.deleted_at || !photo.storage_path) {
      completionPhotoStates.set(photo.task_id, "deleted");
      return;
    }
    if (new Date(photo.expires_at).getTime() <= Date.now()) {
      completionPhotoStates.set(photo.task_id, "expired");
      return;
    }
    const { data: signed, error: signedError } = await supabase.storage.from("task-completion-photos").createSignedUrl(photo.storage_path, 600);
    if (signedError || !signed?.signedUrl) {
      completionPhotoStates.set(photo.task_id, "unavailable");
      return;
    }
    completionPhotoUrls.set(photo.task_id, signed.signedUrl);
  }));
  const campaignById = new Map((campaignResult.data ?? []).map((campaign) => [campaign.id, campaign]));
  const subtasksByTaskId = new Map<string, SubtaskRow[]>();
  for (const subtask of subtaskResult.data ?? []) {
    subtasksByTaskId.set(subtask.task_id, [...(subtasksByTaskId.get(subtask.task_id) ?? []), subtask]);
  }

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
                    {cleanText(task.employees?.full_name, "не выбрано")} · {cleanText(task.stores?.name, "Магазин")}
                  </p>
                  {task.description ? <p className="mt-2 text-sm text-muted">{cleanText(task.description, "Описание")}</p> : null}
              {task.requires_completion_photo && task.status === "done" ? <section className="mt-3 rounded-md border border-line p-3">
                <p className="text-sm font-semibold">Фото выполнения</p>
                {completionPhotoUrls.get(task.id) ? (
                  <a className="mt-2 block max-w-xl overflow-hidden rounded-md border border-line" href={completionPhotoUrls.get(task.id)!} rel="noreferrer" target="_blank">
                    <Image alt={`Фото выполнения задачи «${cleanText(task.title, "Задача")}`} className="h-auto max-h-96 w-full object-contain" height={960} unoptimized src={completionPhotoUrls.get(task.id)!} width={1280} />
                  </a>
                ) : completionPhotoStates.get(task.id) === "deleted" ? (
                  <p className="mt-2 text-sm text-muted">Фото удалено по истечении 7 дней с момента закрытия задачи.</p>
                ) : completionPhotoStates.get(task.id) === "expired" ? (
                  <p className="mt-2 text-sm text-muted">Срок хранения фото истёк. Оно будет удалено автоматически не позднее 7 дней с момента закрытия задачи.</p>
                ) : (
                  <p className="mt-2 text-sm text-muted">Фото выполнения пока недоступно.</p>
                )}
              </section> : null}
                  {task.completion_outcome ? <div className="mt-3 rounded-md bg-surface p-3 text-sm">
                    <p className="font-semibold">Итог: {task.completion_outcome === "sold_out" ? "товар распродан" : task.completion_outcome === "writeoff" ? "часть товара отмечена к списанию" : "остатки распределены"}</p>
                    {task.completion_comment ? <p className="mt-1 text-muted">{cleanText(task.completion_comment, "Комментарий")}</p> : null}
                  </div> : null}
                  {task.expiration_campaign_id && campaignById.get(task.expiration_campaign_id) ? (() => {
                    const campaign = campaignById.get(task.expiration_campaign_id as string)!;
                    return <div className="mt-3 rounded-md border border-brand/20 bg-brand/5 p-3 text-sm">
                      <p className="font-semibold">Сроковая акция · {campaign.product_name}</p>
                      <p className="mt-1 text-muted">Годен до {campaign.expiry_date.split("-").reverse().join(".")} · {campaign.discount_type === "percent" ? `Скидка ${campaign.discount_value}%` : `Цена акции ${new Intl.NumberFormat("ru-RU").format(campaign.discount_value)} ₽`}</p>
                    </div>;
                  })() : null}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="rounded-md bg-surface px-2 py-1 text-xs font-medium">{priorityLabels[task.priority]}</span>
                  <span className="rounded-md border border-brand/30 bg-brand/10 px-2 py-1 text-xs font-medium text-brand">{statusLabels[task.status]}</span>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-3 text-sm text-muted">
                <span className="inline-flex items-center gap-1">
                  <Clock size={15} /> Поставлена: {formatStoreDateTime(task.created_at, task.stores?.timezone)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock size={15} /> Срок: {formatStoreDateTime(task.due_at, task.stores?.timezone)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock size={15} /> Завершено: {formatStoreDateTime(task.completed_at, task.stores?.timezone)}
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

              {(subtasksByTaskId.get(task.id) ?? []).length > 0 ? <section className="mt-4 grid gap-2">
                <h3 className="text-sm font-semibold">Подзадачи</h3>
                {(subtasksByTaskId.get(task.id) ?? []).map((subtask) => <div key={subtask.id} className="rounded-md border border-line p-3">
                  <p className="text-sm font-medium">{subtask.title}</p>
                  {subtask.instructions ? <p className="mt-1 text-xs text-muted">{subtask.instructions}</p> : null}
                  <p className="mt-1 text-xs text-muted">{subtask.status === "done" ? "Выполнена" : "Открыта"}</p>
                  {subtask.status === "done" && task.created_by === user.id ? <form action="/tasks/subtasks/status" method="post" className="mt-2 grid gap-2">
                    <input name="subtask_id" type="hidden" value={subtask.id} /><input name="status" type="hidden" value="open" />
                    <input className="h-10 rounded-md border border-line px-3 text-sm" name="comment" placeholder="Почему нужно переделать?" required />
                    <button className="h-9 rounded-md border border-line px-3 text-sm font-semibold">Возобновить подзадачу</button>
                  </form> : null}
                </div>)}
              </section> : null}
            </article>
          ))}
        </div>
      </div>
      <BottomNav />
    </main>
  );
}
