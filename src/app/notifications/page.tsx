import { Bell, CheckCheck, ExternalLink } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { PushNotificationsPanel } from "@/components/push-notifications-panel";
import { SectionHeader } from "@/components/section-header";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type NotificationRow = {
  id: string;
  event_type: string;
  title: string;
  body: string;
  related_entity_type: string | null;
  related_entity_id: string | null;
  is_read: boolean;
  created_at: string;
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function notificationTitle(item: NotificationRow) {
  return item.event_type === "schedule_changed" ? "График изменён" : item.title;
}

function notificationBody(item: NotificationRow) {
  if (item.event_type !== "schedule_changed") return item.body;
  const changes = item.body.match(/(\d+)/)?.[1] ?? "0";
  return `Изменено смен: ${changes}. Проверьте график.`;
}

function relatedHref(item: NotificationRow) {
  if (item.related_entity_type === "shift") {
    return item.related_entity_id ? `/shifts/${item.related_entity_id}` : "/shifts";
  }

  if (item.related_entity_type === "task") {
    return item.related_entity_id ? `/tasks?taskId=${item.related_entity_id}#${item.related_entity_id}` : "/tasks";
  }

  if (item.related_entity_type === "checklist_submission") {
    return item.related_entity_id ? `/checklists/${item.related_entity_id}` : "/checklists";
  }

  if (item.related_entity_type === "schedule") {
    return "/schedule";
  }

  if (item.related_entity_type === "routine" || item.related_entity_type === "day_routine") {
    if (item.event_type === "day_routine_photo_needs_attention") return "/routine";
    const kind = item.event_type.startsWith("morning_") ? "morning" : "evening";
    return item.related_entity_id ? `/routine/${kind}?sessionId=${item.related_entity_id}` : `/routine/${kind}`;
  }

  if (["schedule_changed"].includes(item.event_type)) {
    return "/schedule";
  }

  if (["new_task", "task_completed", "task_overdue", "task_deadline_soon"].includes(item.event_type)) {
    return "/tasks";
  }

  if (item.event_type.startsWith("morning_routine_")) {
    return "/routine/morning";
  }

  if (item.event_type.startsWith("evening_routine_")) {
    return "/routine/evening";
  }

  if (["checklist_saved", "bad_checklist"].includes(item.event_type)) {
    return "/checklists";
  }

  if (["supplier_promotion_created", "purchase_order_created"].includes(item.event_type)) {
    return "/procurement";
  }

  return null;
}

const PAGE_SIZE = 20;

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string | string[] }>;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const resolvedSearchParams = (await searchParams) ?? {};
  const rawPage = Array.isArray(resolvedSearchParams.page) ? resolvedSearchParams.page[0] : resolvedSearchParams.page;
  const page = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, count, error } = await supabase
    .from("notifications")
    .select("id, event_type, title, body, related_entity_type, related_entity_id, is_read, created_at", { count: "exact" })
    .eq("recipient_profile_id", user.id)
    .order("created_at", { ascending: false })
    .range(from, to)
    .returns<NotificationRow[]>();

  if (error) {
    throw new Error(error.message);
  }

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-4xl">
        <SectionHeader icon={Bell} title="Уведомления" showBack />
        <PushNotificationsPanel hasActiveSubscription={false} />
        {data.some((item) => !item.is_read) ? (
          <form action="/notifications/read-all" className="mt-4" method="post">
            <button className="inline-flex h-10 items-center justify-center gap-2 ui-panel px-3 text-sm font-semibold shadow-soft">
              <CheckCheck size={16} /> Прочитать все
            </button>
          </form>
        ) : null}

        <div className="mt-4 divide-y divide-line ui-panel shadow-soft">
          {data.length === 0 ? (
            <p className="p-4 text-sm text-muted">Уведомлений пока нет.</p>
          ) : (
            data.map((item) => {
              const href = relatedHref(item);

              return (
                <article key={item.id} className={`p-4 ${item.is_read ? "" : "bg-surface"}`}>
                  <div className="flex items-start justify-between gap-3">
                    {href ? (
                      <a className="min-w-0 transition hover:text-brand" href={href}>
                        <p className="font-semibold">{notificationTitle(item)}</p>
                        <p className="mt-1 text-sm text-muted">{notificationBody(item)}</p>
                      </a>
                    ) : (
                      <div className="min-w-0">
                        <p className="font-semibold">{notificationTitle(item)}</p>
                        <p className="mt-1 text-sm text-muted">{notificationBody(item)}</p>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted">{formatTime(item.created_at)}</p>
                    <div className="flex flex-wrap gap-2">
                      {href ? (
                        <a
                          className="inline-flex h-9 items-center justify-center gap-2 ui-panel px-3 text-sm font-semibold"
                          href={href}
                        >
                          <ExternalLink size={15} /> Открыть
                        </a>
                      ) : null}
                      {!item.is_read ? (
                        <form action="/notifications/read" method="post">
                          <input name="notification_id" type="hidden" value={item.id} />
                          <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-brand px-3 text-sm font-semibold text-white">
                            <CheckCheck size={15} /> Прочитано
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
        {totalPages > 1 ? (
          <nav aria-label="Навигация по уведомлениям" className="mt-4 flex items-center justify-between gap-3">
            {page > 1 ? (
              <Link className="ui-panel px-3 py-2 text-sm font-semibold" href={`/notifications?page=${page - 1}`}>
                Назад
              </Link>
            ) : <span />}
            <span className="text-xs text-muted">{page} / {totalPages}</span>
            {page < totalPages ? (
              <Link className="ui-panel px-3 py-2 text-sm font-semibold" href={`/notifications?page=${page + 1}`}>
                Далее
              </Link>
            ) : <span />}
          </nav>
        ) : null}
      </div>
      <BottomNav />
    </main>
  );
}






