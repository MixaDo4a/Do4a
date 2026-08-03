import { Archive, CalendarDays } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { SectionHeader } from "@/components/section-header";
import { getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<{ month?: string; storeId?: string; status?: string }>;
};

type StoreRow = {
  id: string;
  name: string;
  city: string;
  status: string;
};

type ShiftRow = {
  id: string;
  shift_date: string;
  status: string;
  closed_at: string | null;
  stores: { id: string; name: string; city: string } | null;
  shift_participants: {
    participant_role: string;
    employees: { full_name: string } | null;
  }[];
};

function monthStart(value?: string) {
  if (value && /^\d{4}-\d{2}$/.test(value)) {
    return `${value}-01`;
  }

  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function monthEnd(monthStartValue: string) {
  const start = new Date(`${monthStartValue}T00:00:00Z`);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
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
    month: "short",
  }).format(new Date(`${value}T00:00:00Z`));
}

export default async function AdminClosedShiftsPage({ searchParams }: PageProps) {
  const { month, storeId, status } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { roles } = await getCurrentRoleCodes();
  if (!hasAnyRole(roles, MANAGE_ROLES)) {
    redirect("/");
  }

  const accessibleStores = await getAccessibleStores();
  const accessibleStoreIds = accessibleStores.map((store) => store.id);
  const selectedMonth = monthStart(month);
  const selectedMonthEnd = monthEnd(selectedMonth);
  const selectedStatus = status && ["closed", "auto_closed"].includes(status) ? status : "closed";
  const selectedStoreId = storeId && accessibleStoreIds.includes(storeId) ? storeId : "";

  const stores = accessibleStores
    .filter((store) => store.status === "active")
    .sort((left, right) => `${left.city} ${left.name}`.localeCompare(`${right.city} ${right.name}`));

  const query = supabase
    .from("shifts")
    .select("id, shift_date, status, closed_at, stores(id, name, city), shift_participants(participant_role, employees(full_name))")
    .gte("shift_date", selectedMonth)
    .lte("shift_date", selectedMonthEnd)
    .in("store_id", accessibleStoreIds)
    .in("status", ["closed", "auto_closed"])
    .order("shift_date", { ascending: false })
    .limit(120);

  if (selectedStoreId) {
    query.eq("store_id", selectedStoreId);
  }

  if (selectedStatus !== "closed") {
    query.eq("status", selectedStatus);
  }

  const { data, error } = await query.returns<ShiftRow[]>();
  if (error) {
    throw new Error(error.message);
  }

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-5xl">
        <SectionHeader icon={Archive} title="Закрытые смены" showBack />

        <section className="mt-4 ui-panel p-4">
          <form className="grid gap-3 sm:grid-cols-[180px_minmax(220px,1fr)_180px_auto]" method="get">
            <input className="h-11 rounded-md border border-line px-3" name="month" type="month" defaultValue={selectedMonth.slice(0, 7)} />
            <select className="h-11 rounded-md border border-line px-3" name="storeId" defaultValue={selectedStoreId}>
              <option value="">Все магазины</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}, {store.city}
                </option>
              ))}
            </select>
            <select className="h-11 rounded-md border border-line px-3" name="status" defaultValue={selectedStatus}>
              <option value="closed">Закрытые</option>
              <option value="auto_closed">Автозакрытые</option>
            </select>
            <button className="h-11 rounded-md bg-brand px-4 font-semibold text-white">Показать</button>
          </form>

          <p className="mt-4 text-sm text-muted">
            Закрытые смены доступны только по магазинам в вашем подчинении. Здесь можно просматривать состав смены и время закрытия.
          </p>
        </section>

        <section className="mt-4 grid gap-3">
          {data.length === 0 ? (
            <p className="ui-panel p-4 text-sm text-muted">Закрытых смен за выбранный период нет.</p>
          ) : (
            data.map((shift) => (
              <article key={shift.id} className="ui-panel p-4 shadow-soft">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">
                      {shift.stores?.name ?? "Магазин"} · {shift.stores?.city ?? ""}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {formatDate(shift.shift_date)} · {shift.status === "auto_closed" ? "Автозакрыта" : "Закрыта"}
                    </p>
                  </div>
                  <span className="rounded-full bg-brand/15 px-3 py-1 text-xs font-semibold text-brand">{formatDateTime(shift.closed_at)}</span>
                </div>
                <div className="mt-3 grid gap-2 text-sm text-muted sm:grid-cols-2">
                  {shift.shift_participants.length === 0 ? <p>Участники смены не указаны.</p> : null}
                  {shift.shift_participants.map((participant, index) => (
                    <div key={`${shift.id}_${index}`} className="rounded-2xl border border-line/70 bg-[#0d090a]/92 p-3">
                      <p className="font-medium text-ink">{participant.employees?.full_name ?? "Сотрудник"}</p>
                      <p className="mt-1">
                        {participant.participant_role === "primary" ? "Основной" : participant.participant_role === "secondary" ? "Второй" : participant.participant_role}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="mt-4">
                  <Link className="inline-flex h-10 items-center justify-center rounded-md border border-line px-4 text-sm font-semibold" href={`/shifts/${shift.id}`}>
                    Открыть смену
                  </Link>
                </div>
              </article>
            ))
          )}
        </section>
      </div>
      <BottomNav />
    </main>
  );
}
