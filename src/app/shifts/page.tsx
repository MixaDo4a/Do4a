import { CalendarDays, CirclePlay, Eye, Store, UserRound } from "lucide-react";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { SectionHeader } from "@/components/section-header";
import { getCurrentEmployeeId, getCurrentRoleCodes, hasAnyRole, OPEN_SHIFT_ROLES } from "@/lib/auth/roles";
import { employeeName } from "@/lib/display";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ShiftRow = {
  id: string;
  shift_date: string;
  status: string;
  stores: { name: string } | null;
  shift_participants: {
    participant_role: "primary_seller" | "secondary_seller";
    employees: { id: string; full_name: string } | null;
  }[];
};

type StoreOption = {
  id: string;
  name: string;
};

type ShiftsPageProps = {
  searchParams: Promise<{ storeId?: string; dateFrom?: string; dateTo?: string; message?: string; detail?: string }>;
};

const statusLabels: Record<string, string> = {
  planned: "Запланирована",
  opened: "Открыта",
  closed: "Закрыта",
  auto_closed: "Автозакрыта",
  cancelled: "Отменена",
  correction_required: "Нужна проверка",
};

const participantLabels: Record<string, string> = {
  primary_seller: "Основной",
  secondary_seller: "Второй",
};

const messageLabels: Record<string, string> = {
  "shift-closed": "Смена закрыта, зарплата пересчитана.",
  "shift-closed-payroll-error": "Смена закрыта, но зарплату не удалось пересчитать автоматически.",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
  }).format(new Date(value));
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default async function ShiftsPage({ searchParams }: ShiftsPageProps) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { employeeId } = await getCurrentEmployeeId();
  const { roles } = await getCurrentRoleCodes();
  const canOpenShift = hasAnyRole(roles, OPEN_SHIFT_ROLES);
  const defaultDate = todayIso();
  const dateFrom = params.dateFrom || defaultDate;
  const dateTo = params.dateTo || defaultDate;

  const storesResult = employeeId
    ? await supabase
        .from("employee_store_assignments")
        .select("stores(id, name)")
        .eq("employee_id", employeeId)
        .or(`valid_to.is.null,valid_to.gte.${dateFrom}`)
        .returns<{ stores: StoreOption | StoreOption[] | null }[]>()
    : { data: [], error: null };

  if (storesResult.error) {
    throw new Error(storesResult.error.message);
  }

  const storeOptions = (storesResult.data ?? [])
    .map((row) => (Array.isArray(row.stores) ? row.stores[0] : row.stores))
    .filter((store): store is StoreOption => Boolean(store));
  const selectedStoreId = params.storeId || "";

  const shiftSelect =
    "id, shift_date, status, stores(name), shift_participants(participant_role, employees(id, full_name))";

  let openShiftsQuery = supabase
    .from("shifts")
    .select(shiftSelect)
    .in("status", ["opened", "correction_required"])
    .order("shift_date", { ascending: false });

  let datedShiftsQuery = supabase
    .from("shifts")
    .select(shiftSelect)
    .gte("shift_date", dateFrom)
    .lte("shift_date", dateTo)
    .order("shift_date", { ascending: true });

  if (selectedStoreId) {
    openShiftsQuery = openShiftsQuery.eq("store_id", selectedStoreId);
    datedShiftsQuery = datedShiftsQuery.eq("store_id", selectedStoreId);
  } else if (storeOptions.length > 0) {
    openShiftsQuery = openShiftsQuery.in(
      "store_id",
      storeOptions.map((store) => store.id),
    );
    datedShiftsQuery = datedShiftsQuery.in(
      "store_id",
      storeOptions.map((store) => store.id),
    );
  }

  const [openShiftsResult, datedShiftsResult] = await Promise.all([
    openShiftsQuery.returns<ShiftRow[]>(),
    datedShiftsQuery.returns<ShiftRow[]>(),
  ]);

  if (openShiftsResult.error) {
    throw new Error(openShiftsResult.error.message);
  }

  if (datedShiftsResult.error) {
    throw new Error(datedShiftsResult.error.message);
  }

  const shiftsById = new Map<string, ShiftRow>();
  [...(openShiftsResult.data ?? []), ...(datedShiftsResult.data ?? [])].forEach((shift) => {
    shiftsById.set(shift.id, shift);
  });

  const shifts = [...shiftsById.values()].sort((left, right) => {
    const leftPriority = left.status === "opened" || left.status === "correction_required" ? 0 : 1;
    const rightPriority = right.status === "opened" || right.status === "correction_required" ? 0 : 1;

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    if (leftPriority === 0) {
      return right.shift_date.localeCompare(left.shift_date);
    }

    return left.shift_date.localeCompare(right.shift_date);
  });

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-4xl">
        <SectionHeader
          icon={CalendarDays}
          title="Смены"
          action={canOpenShift ? "Открыть" : undefined}
          href={canOpenShift ? "/shifts/open" : undefined}
          showBack
        />

        {params.message ? (
          <p className="mt-4 ui-panel p-3 text-sm text-muted shadow-soft">
            {messageLabels[params.message] ?? params.message}
            {params.detail ? <span className="mt-1 block text-xs text-brand">{params.detail}</span> : null}
          </p>
        ) : null}

        <form className="mt-4 grid gap-3 ui-panel p-4 sm:grid-cols-4" method="get">
          <label className="grid gap-1 text-sm sm:col-span-2">
            <span className="text-muted">Магазин</span>
            <select className="h-11 ui-panel px-3" name="storeId" defaultValue={selectedStoreId}>
              <option value="">Все доступные магазины</option>
              {storeOptions.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted">С даты</span>
            <input className="h-11 ui-panel px-3" name="dateFrom" type="date" defaultValue={dateFrom} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted">По дату</span>
            <input className="h-11 ui-panel px-3" name="dateTo" type="date" defaultValue={dateTo} />
          </label>
          <button className="h-11 rounded-md bg-brand px-4 font-semibold text-white sm:col-span-4">Показать смены</button>
        </form>

        <div className="mt-4 grid gap-3">
          {shifts.length === 0 ? (
            <section className="ui-panel p-5 text-sm text-muted shadow-soft">
              Нет доступных смен.
            </section>
          ) : (
            shifts.map((shift) => (
              <article key={shift.id} className="ui-panel p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{formatDate(shift.shift_date)}</p>
                    <p className="mt-1 flex items-center gap-2 text-sm text-muted">
                      <Store size={16} /> {shift.stores?.name ?? "Магазин не указан"}
                    </p>
                  </div>
                  <span className="rounded-md bg-surface px-2 py-1 text-xs font-medium">
                    {statusLabels[shift.status] ?? shift.status}
                  </span>
                </div>

                <div className="mt-3 grid gap-2">
                  {shift.shift_participants.map((participant) => (
                    <p
                      key={participant.participant_role}
                      className="flex items-center gap-2 text-sm text-muted"
                    >
                      <UserRound size={16} />
                      <span className="font-medium text-ink">
                        {employeeName(participant.employees)}
                      </span>
                      <span>{participantLabels[participant.participant_role]}</span>
                    </p>
                  ))}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <a
                    className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-semibold"
                    href={`/shifts/${shift.id}`}
                  >
                    <Eye size={16} /> Посмотреть
                  </a>

                  {shift.status === "opened" || shift.status === "correction_required" ? (
                    <a
                      className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-semibold"
                      href={`/shifts/close?shiftId=${shift.id}`}
                    >
                      <CirclePlay size={16} /> Закрыть смену
                    </a>
                  ) : null}
                </div>
              </article>
            ))
          )}
        </div>
      </div>
      <BottomNav />
    </main>
  );
}


