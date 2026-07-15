import { Bell, CheckCheck, ExternalLink } from "lucide-react";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
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

const eventLabels: Record<string, string> = {
  new_task: "Новая задача",
  task_deadline_soon: "Дедлайн задачи",
  task_overdue: "Просроченная задача",
  schedule_changed: "График изменён",
  shift_reminder: "Напоминание о смене",
  shift_end_reminder: "Смена скоро закончится",
  close_shift_reminder: "Закрыть смену",
  shift_not_opened: "Смена не открыта вовремя",
  shift_not_closed: "Смена не закрыта вовремя",
  unclosed_shift: "Незакрытая смена",
  auto_closed_shift: "Автозакрытие",
  bad_checklist: "Плохой чек-лист",
};

function relatedHref(item: NotificationRow) {
  if (!item.related_entity_id) {
    return null;
  }

  if (item.related_entity_type === "shift") {
    return `/shifts/${item.related_entity_id}`;
  }

  if (item.related_entity_type === "task") {
    return "/tasks";
  }

  return null;
}

export default async function NotificationsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data, error } = await supabase
    .from("notifications")
    .select("id, event_type, title, body, related_entity_type, related_entity_id, is_read, created_at")
    .eq("recipient_profile_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<NotificationRow[]>();

  if (error) {
    throw new Error(error.message);
  }

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-4xl">
        <SectionHeader icon={Bell} title="Уведомления" showBack />
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
                    <div className="min-w-0">
                      <p className="font-semibold">{item.title}</p>
                      <p className="mt-1 text-sm text-muted">{item.body}</p>
                    </div>
                    <span className="shrink-0 rounded-md bg-white px-2 py-1 text-xs text-muted">
                      {eventLabels[item.event_type] ?? item.event_type}
                    </span>
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
      </div>
      <BottomNav />
    </main>
  );
}



