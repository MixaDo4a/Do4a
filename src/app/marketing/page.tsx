import { BadgePercent, Bell, Check, ClipboardList, Home, Plus, Tag } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentRoleCodes } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { notificationCutoffIso } from "@/lib/notification-retention";
import { formatStoreDateTime } from "@/lib/timezone";

type PageProps = { searchParams: Promise<{ tab?: string; period?: string; message?: string; detail?: string }> };
type Relation<T> = T | T[] | null;
type MonthlyMetricRow = {
  store_id: string; period_start: string; revenue_amount: number | string; returns_amount: number | string;
  receipt_count: number; items_sold_count: number | null;
};
type ShiftMetricRow = {
  store_id: string; shift_date: string; status: string; is_erroneous: boolean;
  shift_closing_reports: Relation<{
    net_revenue: number | string | null; gross_revenue: number | string | null;
    cash_revenue: number | string | null; card_revenue: number | string | null;
    cash_returns: number | string | null; card_returns: number | string | null;
    receipt_count: number | null; items_sold_count: number | null;
  }>;
};
type TaskRow = {
  id: string; store_id: string; title: string; description: string | null; status: string;
  task_type: string; created_at: string; due_at: string | null;
  stores: Relation<{ name: string; timezone: string | null }>;
  task_subtasks: { id: string; title: string; status: string }[];
};
type PromotionRow = {
  id: string; supplier_name: string; product_name: string; promotion_terms: string;
  starts_on: string | null; ends_on: string | null; created_at: string;
  stores: Relation<{ name: string; city: string }>;
};
type NotificationRow = {
  id: string; title: string; body: string; event_type: string; is_read: boolean;
  related_entity_type: string | null; related_entity_id: string | null; created_at: string;
};

const tabs = [
  { id: "tasks", label: "Задачи", icon: ClipboardList },
  { id: "home", label: "Главное", icon: Home },
  { id: "notifications", label: "Уведомления", icon: Bell },
  { id: "promotions", label: "Акции", icon: Tag },
] as const;
type Tab = (typeof tabs)[number]["id"];

function one<T>(value: Relation<T>): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
function number(value: number | string | null | undefined) { return Number(value ?? 0); }
function validPeriod(value?: string) {
  if (value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return value;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Vladivostok", year: "numeric", month: "2-digit" }).format(new Date());
}
function statusLabel(status: string) {
  return ({ open: "Открыта", in_progress: "В работе", overdue: "Просрочена", done: "Выполнена", cancelled: "Отменена" } as Record<string, string>)[status] ?? status;
}
function notificationHref(item: NotificationRow) {
  if (item.related_entity_type === "task" || ["new_task", "task_completed", "task_overdue", "task_deadline_soon"].includes(item.event_type)) return "/tasks";
  if (item.related_entity_type === "supplier_promotion" || item.event_type === "supplier_promotion_created") return "/marketing?tab=promotions";
  return null;
}
function money(value: number | null) {
  return value == null ? "—" : `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value)} ₽`;
}

export default async function MarketingPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const tab = tabs.some((item) => item.id === params.tab) ? params.tab as Tab : "home";
  const period = validPeriod(params.period);
  const periodStart = `${period}-01`;
  const [year, month] = period.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const currentPeriod = validPeriod();
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { roles } = await getCurrentRoleCodes(supabase, user);
  if (!roles.includes("marketer")) redirect("/");

  const stores = await getAccessibleStores(supabase);
  const storeIds = stores.map((store) => store.id);
  const moneyFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
  const monthLabel = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${period}-01T00:00:00Z`));

  const [monthlyResult, shiftsResult, tasksResult, promotionsResult, notificationsResult] = await Promise.all([
    tab === "home" && storeIds.length
      ? supabase.from("store_monthly_historical_analytics").select("store_id, period_start, revenue_amount, returns_amount, receipt_count, items_sold_count")
          .in("store_id", storeIds).eq("period_start", periodStart).returns<MonthlyMetricRow[]>()
      : Promise.resolve({ data: [] as MonthlyMetricRow[], error: null }),
    tab === "home" && storeIds.length
      ? supabase.from("shifts").select("store_id, shift_date, status, is_erroneous, shift_closing_reports(net_revenue, gross_revenue, cash_revenue, card_revenue, cash_returns, card_returns, receipt_count, items_sold_count)")
          .in("store_id", storeIds).gte("shift_date", periodStart).lt("shift_date", nextMonth).in("status", ["closed", "auto_closed"])
          .returns<ShiftMetricRow[]>()
      : Promise.resolve({ data: [] as ShiftMetricRow[], error: null }),
    tab === "tasks" && storeIds.length
      ? supabase.from("tasks").select("id, store_id, title, description, status, task_type, created_at, due_at, stores(name, timezone), task_subtasks(id, title, status)")
          .in("store_id", storeIds).order("due_at", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }).limit(500).returns<TaskRow[]>()
      : Promise.resolve({ data: [] as TaskRow[], error: null }),
    tab === "promotions" && storeIds.length
      ? supabase.from("supplier_promotions").select("id, supplier_name, product_name, promotion_terms, starts_on, ends_on, created_at, stores(name, city)")
          .in("store_id", storeIds).order("created_at", { ascending: false }).limit(100).returns<PromotionRow[]>()
      : Promise.resolve({ data: [] as PromotionRow[], error: null }),
    tab === "notifications"
      ? supabase.from("notifications").select("id, title, body, event_type, is_read, related_entity_type, related_entity_id, created_at")
          .eq("recipient_profile_id", user.id).gte("created_at", notificationCutoffIso()).order("created_at", { ascending: false }).limit(50).returns<NotificationRow[]>()
      : Promise.resolve({ data: [] as NotificationRow[], error: null }),
  ]);
  for (const result of [monthlyResult, shiftsResult, tasksResult, promotionsResult, notificationsResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const monthlyByStore = new Map((monthlyResult.data ?? []).map((row) => [row.store_id, row]));
  const shiftsByStore = new Map<string, ShiftMetricRow[]>();
  for (const shift of shiftsResult.data ?? []) {
    if (shift.is_erroneous) continue;
    const rows = shiftsByStore.get(shift.store_id) ?? [];
    rows.push(shift);
    shiftsByStore.set(shift.store_id, rows);
  }

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-8 pt-4 text-ink">
      <div className="mx-auto max-w-6xl">
        <header className="mb-4">
          <h1 className="text-xl font-semibold">Маркетинг</h1>
          <p className="mt-1 text-sm text-muted">Магазины в зоне вашего доступа: {stores.length}</p>
        </header>
        <nav aria-label="Разделы маркетолога" className="grid grid-cols-4 gap-1 border-b border-line">
          {tabs.map(({ id, label, icon: Icon }) => (
            <Link key={id} aria-current={tab === id ? "page" : undefined}
              className={`flex min-h-12 min-w-0 items-center justify-center gap-1 border-b-2 px-1 text-center text-xs font-semibold sm:gap-2 sm:text-sm ${tab === id ? "border-brand text-ink" : "border-transparent text-muted hover:text-ink"}`}
              href={`/marketing?tab=${id}${id === "home" ? `&period=${period}` : ""}`}>
              <Icon aria-hidden size={16} className="shrink-0" /><span>{label}</span>
            </Link>
          ))}
        </nav>

        {params.message ? <p role="status" className="mt-4 ui-panel p-3 text-sm">{params.message === "saved" ? "Акция создана и отправлена в магазины." : params.message === "required" ? "Выберите магазины и заполните обязательные поля." : params.detail || "Не удалось сохранить акцию."}</p> : null}

        {tab === "home" ? <section className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">Показатели магазинов · {monthLabel}</h2>
            <form action="/marketing" className="flex items-center gap-2" method="get">
              <input name="tab" type="hidden" value="home" />
              <label className="text-sm text-muted" htmlFor="marketing-period">Месяц</label>
              <input id="marketing-period" name="period" type="month" defaultValue={period} className="h-10 rounded-md border border-line bg-surface px-3 text-sm" />
              <button className="h-10 rounded-md border border-line px-3 text-sm font-semibold">Показать</button>
            </form>
          </div>
          {stores.length ? <div className="mt-3 overflow-x-auto ui-panel">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="border-b border-line text-xs text-muted"><tr>
                <th className="p-3">Магазин</th><th className="p-3">Средний чек</th><th className="p-3">Товаров в чеке</th><th className="p-3">Оборот</th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {stores.map((store) => {
                  const imported = period === currentPeriod ? undefined : monthlyByStore.get(store.id);
                  const shifts = shiftsByStore.get(store.id) ?? [];
                  const reportRows = shifts.map((shift) => one(shift.shift_closing_reports)).filter((report) => report !== null);
                  const net = imported
                    ? number(imported.revenue_amount) - number(imported.returns_amount)
                    : reportRows.reduce((sum, report) => {
                        const gross = report.gross_revenue != null
                          ? number(report.gross_revenue)
                          : number(report.cash_revenue) + number(report.card_revenue);
                        const reportNet = report.net_revenue != null
                          ? number(report.net_revenue)
                          : gross - number(report.cash_returns) - number(report.card_returns);
                        return sum + reportNet;
                      }, 0);
                  const receipts = imported ? imported.receipt_count : reportRows.reduce((sum, report) => sum + Number(report.receipt_count ?? 0), 0);
                  const reportRowsWithItems = reportRows.filter((report) => report.items_sold_count != null);
                  const items = imported?.items_sold_count ?? reportRowsWithItems.reduce((sum, report) => sum + Number(report.items_sold_count), 0);
                  const hasItems = imported?.items_sold_count != null || reportRowsWithItems.length > 0;
                  return <tr key={store.id}>
                    <th className="p-3 font-medium">{store.name}<span className="mt-0.5 block text-xs font-normal text-muted">{store.city}</span></th>
                    <td className="p-3 tabular-nums">{receipts > 0 ? moneyFormat.format(net / receipts) + " ₽" : "—"}</td>
                    <td className="p-3 tabular-nums">{receipts > 0 && hasItems ? (items / receipts).toLocaleString("ru-RU", { maximumFractionDigits: 2 }) : "—"}</td>
                    <td className="p-3 tabular-nums">{money(net)}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div> : <p className="mt-4 ui-panel p-4 text-sm text-muted">Нет доступных магазинов.</p>}
          <p className="mt-2 text-xs text-muted">Средний чек: оборот после возвратов, делённый на число чеков. Товаров в чеке: количество проданных единиц, делённое на число чеков. Ошибочные смены не учитываются.</p>
        </section> : null}

        {tab === "tasks" ? <section className="mt-4">
          <h2 className="font-semibold">Доступные задачи</h2>
          <div className="mt-3 grid gap-3">
            {(tasksResult.data ?? []).length ? (tasksResult.data ?? []).map((task) => <article key={task.id} className="ui-panel p-4">
              <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="font-semibold">{task.title}</h3><p className="mt-1 text-sm text-muted">{one(task.stores)?.name ?? "Магазин"} · {statusLabel(task.status)}</p>
                {task.description ? <p className="mt-2 whitespace-pre-wrap text-sm">{task.description}</p> : null}</div>
                <span className="shrink-0 text-xs text-muted">{task.due_at ? formatStoreDateTime(task.due_at, one(task.stores)?.timezone) : "Без срока"}</span></div>
              {task.task_subtasks.length ? <ul className="mt-3 grid gap-1 border-t border-line pt-3 text-sm">{task.task_subtasks.map((subtask) => <li key={subtask.id} className="flex items-center justify-between gap-3"><span>{subtask.title}</span><span className="text-xs text-muted">{subtask.status === "done" ? "Выполнена" : "Открыта"}</span></li>)}</ul> : null}
              <Link className="mt-3 inline-flex h-9 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold" href={`/tasks?storeId=${task.store_id}`}><ClipboardList size={15} /> Открыть задачи магазина</Link>
            </article>) : <p className="ui-panel p-4 text-sm text-muted">В доступных магазинах задач пока нет.</p>}
          </div>
        </section> : null}

        {tab === "notifications" ? <section className="mt-4">
          <h2 className="font-semibold">Последние уведомления</h2>
          <div className="mt-3 divide-y divide-line ui-panel">
            {(notificationsResult.data ?? []).length ? (notificationsResult.data ?? []).map((item) => {
              const href = notificationHref(item);
              return <article key={item.id} className={`p-4 ${item.is_read ? "" : "bg-black/20"}`}>
                <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{item.title}</h3><p className="mt-1 text-sm text-muted">{item.body}</p><p className="mt-2 text-xs text-muted">{formatStoreDateTime(item.created_at)}</p></div>{item.is_read ? <Check className="shrink-0 text-muted" size={16} /> : <span className="mt-1 size-2 shrink-0 rounded-full bg-brand" />}</div>
                <div className="mt-3 flex gap-2">{href ? <Link className="text-sm font-semibold text-brand" href={href}>Открыть</Link> : null}{!item.is_read ? <form action="/notifications/read" method="post"><input name="notification_id" type="hidden" value={item.id} /><input name="return_to" type="hidden" value="/marketing?tab=notifications" /><button className="text-sm font-semibold text-muted">Прочитано</button></form> : null}</div>
              </article>;
            }) : <p className="p-4 text-sm text-muted">Уведомлений пока нет.</p>}
          </div>
          <Link href="/notifications" className="mt-3 inline-flex h-10 items-center gap-2 rounded-md border border-line px-3 text-sm font-semibold"><Bell size={16} /> Все уведомления</Link>
        </section> : null}

        {tab === "promotions" ? <section className="mt-4 grid gap-5 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
          <form action="/procurement/promotions/create" className="ui-panel grid content-start gap-3 p-4" method="post">
            <input name="return_to" type="hidden" value="/marketing?tab=promotions" />
            <h2 className="inline-flex items-center gap-2 font-semibold"><Plus size={17} className="text-brand" /> Новая акция</h2>
            <fieldset className="grid gap-2"><legend className="mb-2 text-sm text-muted">Магазины</legend>{stores.map((store) => <label key={store.id} className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm"><input type="checkbox" name="store_ids" value={store.id} /><span>{store.name}, {store.city}</span></label>)}</fieldset>
            <input className="h-10 rounded-md border border-line px-3" name="supplier_name" placeholder="Поставщик или организатор" required />
            <input className="h-10 rounded-md border border-line px-3" name="product_name" placeholder="Товар или тема акции" required />
            <textarea className="min-h-24 rounded-md border border-line px-3 py-2" name="promotion_terms" placeholder="Механика, скидка и условия" required />
            <div className="grid grid-cols-2 gap-2"><label className="grid gap-1 text-xs text-muted">Начало<input className="h-10 rounded-md border border-line px-2 text-sm text-ink" name="starts_on" type="date" /></label><label className="grid gap-1 text-xs text-muted">Окончание<input className="h-10 rounded-md border border-line px-2 text-sm text-ink" name="ends_on" type="date" /></label></div>
            <button disabled={!stores.length} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-semibold text-white disabled:opacity-50"><BadgePercent size={16} /> Создать акцию</button>
          </form>
          <div><h2 className="font-semibold">Архив акций</h2><div className="mt-3 grid gap-2">
            {(promotionsResult.data ?? []).length ? (promotionsResult.data ?? []).map((promotion) => <article key={promotion.id} className="ui-panel p-4">
              <div className="flex flex-wrap justify-between gap-2"><div><h3 className="font-semibold">{promotion.product_name}</h3><p className="mt-1 text-sm text-muted">{promotion.supplier_name} · {one(promotion.stores)?.name ?? "Магазин"}, {one(promotion.stores)?.city ?? ""}</p></div><span className="text-xs text-muted">{promotion.starts_on ?? "Без даты"} — {promotion.ends_on ?? "Без даты"}</span></div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{promotion.promotion_terms}</p>
            </article>) : <p className="ui-panel p-4 text-sm text-muted">Акций пока нет.</p>}
          </div></div>
        </section> : null}
      </div>
    </main>
  );
}
