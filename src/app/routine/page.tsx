import { CalendarClock, Sunrise, Sunset } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { SectionHeader } from "@/components/section-header";
import { getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type OpenShiftRow = {
  id: string;
  shift_date: string;
  store_id: string;
  stores: { name: string; city: string } | null;
  shift_participants: {
    participant_role: "primary_seller" | "secondary_seller";
    employees: { id: string; full_name: string } | null;
  }[];
};

type RoutineStatusRow = {
  id: string;
  shift_id: string;
  routine_kind: "morning" | "evening";
  routine_date: string;
  store_id: string;
  started_at: string;
  completed_at: string | null;
  stores: { name: string; city: string } | null;
  employees: { full_name: string } | null;
};

function formatShortDateTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

export default async function RoutineIndexPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  try {
    await supabase.rpc("run_day_routine_evening_reminders");
  } catch {
    // Best-effort reminder check without cron.
  }

  const { roles } = await getCurrentRoleCodes();
  if (!hasAnyRole(roles, MANAGE_ROLES)) {
    redirect("/");
  }

  const stores = await getAccessibleStores();
  const storeIds = stores.map((store) => store.id);

  const [{ data: openShiftsData, error: openShiftsError }, { data: sessions, error: sessionsError }] = await Promise.all([
    storeIds.length > 0
      ? supabase
          .from("shifts")
          .select("id, shift_date, store_id, stores(name, city), shift_participants(participant_role, employees(id, full_name))")
          .eq("status", "opened")
          .in("store_id", storeIds)
          .order("shift_date", { ascending: false })
          .returns<OpenShiftRow[]>()
      : Promise.resolve({ data: [] as OpenShiftRow[], error: null as null }),
    storeIds.length > 0
      ? supabase
          .from("day_routine_sessions")
          .select("id, shift_id, routine_kind, routine_date, store_id, started_at, completed_at, stores(name, city), employees(full_name)")
          .in("store_id", storeIds)
          .order("routine_date", { ascending: false })
          .limit(20)
          .returns<RoutineStatusRow[]>()
      : Promise.resolve({ data: [] as RoutineStatusRow[], error: null as null }),
  ]);

  if (openShiftsError) {
    throw new Error(openShiftsError.message);
  }

  if (sessionsError) {
    throw new Error(sessionsError.message);
  }

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-5xl">
        <SectionHeader icon={CalendarClock} title="Распорядок дня" showBack />

        <section className="mt-4 ui-panel p-4 shadow-soft">
          <p className="text-sm text-muted">
            Здесь показываются открытые смены по доступным магазинам и быстрый переход к утреннему или вечернему распорядку.
          </p>
        </section>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Link className="ui-panel p-4 shadow-soft transition hover:border-brand/60" href="/routine/morning">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-brand/30 bg-brand/10 text-brand">
                <Sunrise size={22} />
              </span>
              <div>
                <p className="font-semibold">Утренний распорядок</p>
                <p className="text-sm text-muted">Заполнение после открытия смены</p>
              </div>
            </div>
          </Link>

          <Link className="ui-panel p-4 shadow-soft transition hover:border-brand/60" href="/routine/evening">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-brand/30 bg-brand/10 text-brand">
                <Sunset size={22} />
              </span>
              <div>
                <p className="font-semibold">Вечерний распорядок</p>
                <p className="text-sm text-muted">Напоминание в 19:00 по местному времени</p>
              </div>
            </div>
          </Link>
        </div>

        <section className="mt-6 ui-panel p-4 shadow-soft">
          <h2 className="font-semibold">Живые распорядки по открытым сменам</h2>
          <p className="mt-1 text-sm text-muted">Ссылки ведут сразу в распорядок конкретной открытой смены.</p>

          <div className="mt-4 grid gap-3">
            {openShiftsData.length === 0 ? <p className="text-sm text-muted">Открытых смен пока нет.</p> : null}

            {openShiftsData.map((shift) => {
              const primary = shift.shift_participants.find((participant) => participant.participant_role === "primary_seller");
              const secondary = shift.shift_participants.find((participant) => participant.participant_role === "secondary_seller");
              const storeLabel = shift.stores ? `${shift.stores.name}, ${shift.stores.city}` : "Магазин";

              return (
                <article key={shift.id} className="rounded-2xl border border-line/80 bg-[#0d090a]/92 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{storeLabel}</p>
                      <p className="mt-1 text-sm text-muted">{formatDate(shift.shift_date)}</p>
                      <p className="mt-1 text-sm text-muted">
                        {primary?.employees?.full_name ?? "Сотрудник"}
                        {secondary?.employees?.full_name ? ` · ${secondary.employees.full_name}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link
                        className="rounded-2xl border border-brand/30 bg-brand/10 px-3 py-2 text-sm font-medium text-brand transition hover:border-brand/60 hover:bg-brand/15"
                        href={`/routine/morning?shiftId=${shift.id}`}
                      >
                        Утро
                      </Link>
                      <Link
                        className="rounded-2xl border border-brand/30 bg-brand/10 px-3 py-2 text-sm font-medium text-brand transition hover:border-brand/60 hover:bg-brand/15"
                        href={`/routine/evening?shiftId=${shift.id}`}
                      >
                        Вечер
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="mt-6 ui-panel p-4 shadow-soft">
          <h2 className="font-semibold">Онлайн-архив по магазинам</h2>
          <div className="mt-4 grid gap-3">
            {stores.length === 0 ? <p className="text-sm text-muted">Нет доступных магазинов.</p> : null}
            {stores.map((store) => (
              <Link
                key={store.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-line/80 bg-[#0d090a]/92 p-4 transition hover:border-brand/60"
                href={`/routine/archive/${store.id}`}
              >
                <div>
                  <p className="font-semibold">{store.name}</p>
                  <p className="text-sm text-muted">{store.city}</p>
                </div>
                <span className="text-sm text-muted">Архив</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="mt-6 ui-panel p-4 shadow-soft">
          <h2 className="font-semibold">Последние заполнения</h2>
          <div className="mt-4 grid gap-3">
            {sessions.length === 0 ? <p className="text-sm text-muted">Пока нет заполненных распорядков.</p> : null}
            {sessions.map((session) => (
              <article key={session.id} className="rounded-2xl border border-line/80 bg-[#0d090a]/92 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">
                      {session.stores?.name ?? "Магазин"} · {session.stores?.city ?? ""}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {session.employees?.full_name ?? "Сотрудник"} · {session.routine_kind === "morning" ? "Утро" : "Вечер"}
                    </p>
                    <p className="mt-1 text-xs text-muted">Начато: {formatShortDateTime(session.started_at)}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs ${session.completed_at ? "bg-brand/15 text-brand" : "bg-white/10 text-muted"}`}>
                    {session.completed_at ? "Заполнено" : "В процессе"}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
      <BottomNav />
    </main>
  );
}
