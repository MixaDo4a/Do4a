import { Archive } from "lucide-react";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { SectionHeader } from "@/components/section-header";
import { getAccessibleStores } from "@/lib/auth/stores";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PageProps = {
  params: Promise<{ storeId: string }>;
};

type StoreRow = {
  id: string;
  name: string;
  city: string;
};

type SessionRow = {
  id: string;
  routine_kind: "morning" | "evening";
  routine_date: string;
  started_at: string;
  completed_at: string | null;
  employee_id: string;
};

type ItemRow = {
  session_id: string;
  title_snapshot: string;
  parent_title_snapshot: string | null;
  level: number;
  completed_at: string;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function RoutineArchivePage({ params }: PageProps) {
  const { storeId } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const stores = await getAccessibleStores();
  const store = stores.find((item) => item.id === storeId);
  if (!store) {
    redirect("/routine");
  }

  const { data: sessions, error: sessionsError } = await supabase
    .from("day_routine_sessions")
    .select("id, routine_kind, routine_date, started_at, completed_at, employee_id")
    .eq("store_id", storeId)
    .order("routine_date", { ascending: false })
    .limit(30)
    .returns<SessionRow[]>();

  if (sessionsError) {
    throw new Error(sessionsError.message);
  }

  const sessionIds = sessions.map((session) => session.id);
  const employeeIds = [...new Set(sessions.map((session) => session.employee_id))];

  const [{ data: items, error: itemsError }, { data: employees, error: employeesError }] = await Promise.all([
    sessionIds.length > 0
      ? supabase
          .from("day_routine_session_items")
          .select("session_id, title_snapshot, parent_title_snapshot, level, completed_at")
          .in("session_id", sessionIds)
          .order("completed_at", { ascending: true })
          .returns<ItemRow[]>()
      : Promise.resolve({ data: [] as ItemRow[], error: null as null }),
    employeeIds.length > 0
      ? supabase.from("employees").select("id, full_name").in("id", employeeIds).returns<{ id: string; full_name: string }[]>()
      : Promise.resolve({ data: [] as { id: string; full_name: string }[], error: null as null }),
  ]);

  if (itemsError) {
    throw new Error(itemsError.message);
  }

  if (employeesError) {
    throw new Error(employeesError.message);
  }

  const employeeById = new Map((employees ?? []).map((employee) => [employee.id, employee.full_name]));
  const itemsBySessionId = new Map<string, ItemRow[]>();
  (items ?? []).forEach((item) => {
    const next = itemsBySessionId.get(item.session_id) ?? [];
    next.push(item);
    itemsBySessionId.set(item.session_id, next);
  });

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-4xl">
        <SectionHeader icon={Archive} title={`Архив распорядка · ${store.name}`} showBack />
        <section className="mt-4 ui-panel p-4 shadow-soft">
          <p className="text-sm text-muted">{store.city}</p>
        </section>

        <div className="mt-4 grid gap-4">
          {sessions.length === 0 ? (
            <section className="ui-panel p-4 text-sm text-muted shadow-soft">
              По этому магазину ещё нет заполненных распорядков.
            </section>
          ) : null}

          {sessions.map((session) => {
            const sessionItems = itemsBySessionId.get(session.id) ?? [];

            return (
              <article key={session.id} className="ui-panel p-4 shadow-soft">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">
                      {session.routine_kind === "morning" ? "Утро" : "Вечер"} · {session.routine_date}
                    </h2>
                    <p className="mt-1 text-sm text-muted">{employeeById.get(session.employee_id) ?? "Сотрудник"}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs ${session.completed_at ? "bg-brand/15 text-brand" : "bg-white/10 text-muted"}`}>
                    {session.completed_at ? "Заполнено" : "В процессе"}
                  </span>
                </div>

                <div className="mt-3 grid gap-2">
                  {sessionItems.length === 0 ? (
                    <p className="text-sm text-muted">Пока ничего не отмечено.</p>
                  ) : (
                    sessionItems.map((item) => (
                      <div key={`${session.id}_${item.title_snapshot}_${item.completed_at}`} className="rounded-2xl border border-line/80 bg-[#0d090a]/92 p-3">
                        <p className="text-sm" style={{ marginLeft: item.level * 12 }}>
                          {item.title_snapshot}
                        </p>
                        <p className="mt-1 text-[11px] text-muted">{formatDate(item.completed_at)}</p>
                        {item.parent_title_snapshot ? <p className="mt-1 text-[11px] text-muted">Пункт: {item.parent_title_snapshot}</p> : null}
                      </div>
                    ))
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
      <BottomNav />
    </main>
  );
}

