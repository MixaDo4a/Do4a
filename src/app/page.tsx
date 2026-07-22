import {
  Bell,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  ListTodo,
  LogOut,
  PackageSearch,
  ReceiptText,
  ShieldCheck,
  UserRound,
  WalletCards,
} from "lucide-react";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { Metric } from "@/components/metric";
import { SectionHeader } from "@/components/section-header";
import { UpcomingScheduleList } from "@/components/upcoming-schedule-list";
import { cleanText, employeeName } from "@/lib/display";
import { getAccessibleStores } from "@/lib/auth/stores";
import { redirectInvalidSession } from "@/lib/supabase/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ProfileRow = {
  employee_id: string | null;
  full_name: string;
  email: string | null;
  employees: { full_name: string; employee_status: "padawan" | "experienced" } | null;
};

type UserRoleRow = {
  roles: { code: string; name: string } | null;
};

type TaskPreview = {
  id: string;
  title: string;
  due_at: string | null;
};

type ChecklistPreview = {
  id: string;
  submitted_at: string;
  average_score: number | string;
  stores: { name: string } | null;
  employees: { full_name: string } | null;
};

type SchedulePreview = {
  id: string;
  store_id: string;
  shift_date: string;
  status: string;
  stores: { id: string; name: string; city: string } | null;
  employee_id: string;
};

type EmployeeLookupRow = {
  id: string;
  full_name: string;
};

const managementRoles = ["manager", "store_manager", "super_admin", "developer"];

const roleLabels: Record<string, string> = {
  manager: "Менеджер",
  auditor: "Проверяющий",
  store_manager: "Управляющий",
  buyer: "Закупщик",
  warehouse_manager: "Кладовщик",
  warehouse_assistant: "Помощник кладовщика",
  super_admin: "Супер-админ",
  developer: "Разработчик",
};

const statusLabels: Record<string, string> = {
  planned: "Р1",
  planned_secondary: "Р2",
  opened: "О",
  closed: "З",
  auto_closed: "З",
  cancelled: "—",
  correction_required: "Корр.",
};

const statusClasses: Record<string, string> = {
  planned: "bg-orange-500 text-white border-orange-600",
  planned_secondary: "bg-yellow-400 text-slate-900 border-yellow-500",
  day_off: "bg-green-500 text-white border-green-600",
  sick_leave: "bg-violet-500 text-white border-violet-600",
  vacation: "bg-blue-500 text-white border-blue-600",
  opened: "bg-slate-500 text-white border-slate-600",
  closed: "bg-slate-700 text-white border-slate-800",
  auto_closed: "bg-slate-700 text-white border-slate-800",
  cancelled: "bg-slate-300 text-slate-900 border-slate-400",
  correction_required: "bg-rose-500 text-white border-rose-600",
};

const scheduleGraphLabels: Record<string, string> = {
  planned: "Р1",
  planned_secondary: "Р2",
  day_off: "В",
  sick_leave: "Б",
  vacation: "О",
};

function scheduleCellLabel(status: string | null | undefined) {
  if (!status) return "—";
  return scheduleGraphLabels[status] ?? status;
}

function money(value: number | string | null | undefined) {
  return `${new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0))} руб.`;
}

function todayLabel() {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
}

function formatDate(value: string | null) {
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

function monthStartDate(value?: string) {
  if (value && /^\d{4}-\d{2}$/.test(value)) {
    return `${value}-01`;
  }

  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function monthEndDate(monthStartValue: string) {
  const start = new Date(`${monthStartValue}T00:00:00Z`);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

function monthTitle(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(new Date(`${value}-01T00:00:00Z`));
}

export default async function HomePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("employee_id, full_name, email, employees(full_name, employee_status)")
    .eq("id", user.id)
    .maybeSingle<ProfileRow>();

  if (profileError) {
    redirectInvalidSession(profileError);
    throw new Error(profileError.message);
  }

  const { data: roleRows, error: rolesError } = await supabase
    .from("user_roles")
    .select("roles(code, name)")
    .eq("profile_id", user.id)
    .is("revoked_at", null)
    .returns<UserRoleRow[]>();

  if (rolesError) {
    throw new Error(rolesError.message);
  }

  const roles = roleRows
    .map((row) => row.roles)
    .filter((role): role is { code: string; name: string } => Boolean(role));
  const roleCodes = roles.map((role) => role.code);
  const auditorOnly = roleCodes.includes("auditor") && !roleCodes.some((role) => managementRoles.includes(role));
  const storeManagerView = roleCodes.includes("store_manager") && !auditorOnly;
  const superAdminView = roleCodes.includes("super_admin") && !auditorOnly && !storeManagerView;
  const managementView = storeManagerView || superAdminView;
  const managerOnlyView = roleCodes.includes("manager") && !auditorOnly && !managementView && !roleCodes.includes("developer");
  const warehouseManagerOnlyView = roleCodes.includes("warehouse_manager") && !managementView && !roleCodes.includes("developer");
  const warehouseAssistantOnlyView = roleCodes.includes("warehouse_assistant") && !managementView && !roleCodes.includes("developer");
  const buyerOnlyView = roleCodes.includes("buyer") && !managementView && !roleCodes.includes("developer");
  const supportOnlyView = warehouseManagerOnlyView || warehouseAssistantOnlyView || buyerOnlyView;
  const canSeeAccessibleStoreSchedules = managementView || auditorOnly || warehouseManagerOnlyView || buyerOnlyView;
  const accessibleStores = await getAccessibleStores();
  const accessibleStoreIds = accessibleStores.map((store) => store.id);

  const payrollQuery = supabase
    .from("payroll_entries")
    .select("total_payout_amount, created_at")
    .order("created_at", { ascending: false })
    .limit(1);

  if (profile?.employee_id) {
    payrollQuery.eq("employee_id", profile.employee_id);
  }

  const tasksQuery = managementView || auditorOnly || warehouseManagerOnlyView
    ? supabase
        .from("tasks")
        .select("id, title, due_at")
        .in("store_id", accessibleStoreIds)
        .in("status", ["open", "in_progress", "overdue"])
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(3)
        .returns<TaskPreview[]>()
    : profile?.employee_id
    ? supabase
        .from("tasks")
        .select("id, title, due_at")
        .eq("assignee_employee_id", profile.employee_id)
        .in("status", ["open", "in_progress", "overdue"])
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(3)
        .returns<TaskPreview[]>()
    : Promise.resolve({ data: [] as TaskPreview[], error: null });

  const checklistArchiveQuery =
    auditorOnly && profile?.employee_id
      ? supabase
          .from("checklist_submissions")
          .select(
            "id, submitted_at, average_score, stores(name), employees!checklist_submissions_employee_id_fkey(full_name)",
          )
          .eq("auditor_employee_id", profile.employee_id)
          .order("submitted_at", { ascending: false })
          .limit(3)
          .returns<ChecklistPreview[]>()
      : Promise.resolve({ data: [] as ChecklistPreview[], error: null });

  const selectedMonth = monthStartDate();
  const selectedMonthEnd = monthEndDate(selectedMonth);
  const employeesLookupQuery = supabase.from("employees").select("id, full_name").eq("is_active", true).returns<EmployeeLookupRow[]>();

  const [
    shiftsResult,
    tasksResult,
    notificationsResult,
    checklistResult,
    payrollResult,
    checklistArchiveResult,
    employeesLookupResult,
  ] = await Promise.all([
    auditorOnly || supportOnlyView
      ? Promise.resolve({
          data: [] as { id: string; shift_date: string; status: string; stores: { name: string } | null }[],
          error: null,
        })
      : storeManagerView
        ? supabase
            .from("shifts")
            .select("id, shift_date, status, stores(name)")
            .in("store_id", accessibleStoreIds)
            .order("shift_date", { ascending: false })
            .limit(8)
            .returns<{ id: string; shift_date: string; status: string; stores: { name: string } | null }[]>()
      : supabase
          .from("shifts")
          .select("id, shift_date, status, stores(name)")
          .order("shift_date", { ascending: false })
          .limit(1)
          .returns<{ id: string; shift_date: string; status: string; stores: { name: string } | null }[]>(),
    tasksQuery,
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_profile_id", user.id)
      .eq("is_read", false),
    supabase
      .from("checklist_submissions")
      .select("average_score")
      .order("submitted_at", { ascending: false })
      .limit(5),
    auditorOnly || storeManagerView || supportOnlyView ? Promise.resolve({ data: [] as { total_payout_amount: number | string }[], error: null }) : payrollQuery,
    checklistArchiveQuery,
    employeesLookupQuery,
  ]);

  if (shiftsResult.error) {
    redirectInvalidSession(shiftsResult.error);
    throw new Error(shiftsResult.error.message);
  }

  if (tasksResult.error) {
    redirectInvalidSession(tasksResult.error);
    throw new Error(tasksResult.error.message);
  }

  if (payrollResult.error) {
    throw new Error(payrollResult.error.message);
  }

  if (checklistArchiveResult.error) {
    throw new Error(checklistArchiveResult.error.message);
  }

  if (employeesLookupResult.error) {
    throw new Error(employeesLookupResult.error.message);
  }

  const activeShift = shiftsResult.data[0];
  const tasks = tasksResult.data;
  const checklistArchive = checklistArchiveResult.data;
  const averageChecklist = checklistResult.data?.length
    ? checklistResult.data.reduce((sum, row) => sum + Number(row.average_score), 0) / checklistResult.data.length
    : 10;
  const payrollPreview = payrollResult.data?.[0]?.total_payout_amount ?? 0;
  const scheduleDates = Array.from({ length: new Date(`${selectedMonthEnd}T00:00:00Z`).getUTCDate() }, (_, index) => {
    const current = new Date(`${selectedMonth.slice(0, 7)}-${String(index + 1).padStart(2, "0")}T00:00:00Z`);
    return {
      date: current.toISOString().slice(0, 10),
      day: String(index + 1).padStart(2, "0"),
      weekday: new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(current),
    };
  });
  const employeeNameById = new Map(employeesLookupResult.data.map((employee) => [employee.id, employee.full_name]));
  const schedulePreviewQuery =
    managerOnlyView && profile?.employee_id
      ? supabase
          .from("schedules")
          .select("id, store_id, shift_date, status, stores(id, name, city), employee_id")
          .eq("employee_id", profile.employee_id)
          .gte("shift_date", selectedMonth)
          .lte("shift_date", selectedMonthEnd)
          .order("shift_date", { ascending: true })
          .returns<SchedulePreview[]>()
      : canSeeAccessibleStoreSchedules
      ? accessibleStoreIds.length > 0
        ? supabase
            .from("schedules")
            .select("id, store_id, shift_date, status, stores(id, name, city), employee_id")
            .in("store_id", accessibleStoreIds)
            .gte("shift_date", selectedMonth)
            .lte("shift_date", selectedMonthEnd)
            .order("shift_date", { ascending: true })
            .returns<SchedulePreview[]>()
        : Promise.resolve({ data: [] as SchedulePreview[], error: null })
      : profile?.employee_id
      ? supabase
          .from("schedules")
          .select("id, store_id, shift_date, status, stores(id, name, city), employee_id")
          .eq("employee_id", profile.employee_id)
          .gte("shift_date", selectedMonth)
          .lte("shift_date", selectedMonthEnd)
          .order("shift_date", { ascending: true })
          .returns<SchedulePreview[]>()
      : Promise.resolve({ data: [] as SchedulePreview[], error: null });
  const schedulePreviewResult = await schedulePreviewQuery;

  if (schedulePreviewResult.error) {
    throw new Error(schedulePreviewResult.error.message);
  }

  const schedulePreview = schedulePreviewResult.data;
  const todayIso = new Date().toISOString().slice(0, 10);
  const upcomingSchedules = schedulePreview
    .filter((row) => row.shift_date >= todayIso && ["planned", "planned_secondary"].includes(row.status))
    .sort((left, right) => left.shift_date.localeCompare(right.shift_date))
    .slice(0, 2)
    .map((row) => ({
      id: row.id,
      shift_date: row.shift_date,
      status: row.status,
      stores: row.stores,
      employeeName: employeeNameById.get(row.employee_id) ?? "Сотрудник",
    }));
  const scheduleGroups = new Map<
    string,
    {
      store: { id: string; name: string; city: string } | null;
      rows: Map<string, { employeeId: string; employeeName: string; statuses: Map<string, string> }>;
    }
  >();

  for (const row of schedulePreview) {
    const storeKey = row.stores?.id ?? row.store_id;
    const employeeId = row.employee_id;
    const storeGroup = scheduleGroups.get(storeKey) ?? { store: row.stores, rows: new Map() };
    const employeeRow = storeGroup.rows.get(employeeId) ?? {
      employeeId,
      employeeName: employeeNameById.get(employeeId) ?? "Сотрудник",
      statuses: new Map<string, string>(),
    };
    employeeRow.statuses.set(row.shift_date, row.status);
    storeGroup.rows.set(employeeId, employeeRow);
    scheduleGroups.set(storeKey, storeGroup);
  }
  const roleText = roles?.length
    ? roles.map((role) => roleLabels[role.code] ?? role.name).join(", ")
    : "Роль не назначена";
  const accountName = employeeName(profile?.employees ?? (profile ? { full_name: profile.full_name } : null));

  return (
    <main className="app-shell min-h-dvh bg-surface text-ink">
      <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pb-24 pt-4 sm:px-6 lg:px-8">
        <header className="flex items-start justify-between gap-4 border-b border-line pb-4">
          <div>
            <p className="text-sm font-medium text-muted">{todayLabel()}</p>
            <h1 className="mt-1 text-2xl font-semibold">
              {auditorOnly
                ? "Проверки и задачи"
                : storeManagerView
                  ? "Управление магазинами"
                  : buyerOnlyView
                    ? "Закупки"
                    : warehouseManagerOnlyView || warehouseAssistantOnlyView
                      ? "Склад и задачи"
                      : "Смена и задачи"}
            </h1>
          </div>
          <a
            className="relative grid h-11 w-11 place-items-center ui-panel shadow-soft"
            aria-label="Уведомления"
            href="/notifications"
          >
            <Bell size={20} />
            {notificationsResult.count ? (
              <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1 text-xs text-white">
                {notificationsResult.count}
              </span>
            ) : null}
          </a>
        </header>

        <section className="mt-4 ui-panel p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-surface">
                <UserRound className="text-brand" size={20} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase text-muted">Открыта учётка</p>
                <p className="mt-1 truncate text-base font-semibold">{accountName}</p>
                <p className="mt-1 text-sm text-muted">
                  {profile?.email ?? user.email ?? "Email не указан"} · {roleText}
                </p>
              </div>
            </div>
            <form action="/logout" className="shrink-0" method="post">
              <button className="inline-flex h-10 w-full items-center justify-center gap-2 ui-panel px-3 text-sm font-semibold text-ink shadow-soft sm:w-auto">
                <LogOut size={16} />
                Выйти
              </button>
            </form>
          </div>
        </section>

        {auditorOnly ? (
          <>
            <section className="mt-6 ui-panel p-4">
              <SectionHeader icon={ClipboardCheck} title="Архив чек-листов" action="Открыть" href="/checklists" />
              <div className="mt-4 grid gap-3">
                {checklistArchive.length === 0 ? (
                  <p className="rounded-md bg-surface p-3 text-sm text-muted">Проведённых чек-листов пока нет.</p>
                ) : (
                  checklistArchive.map((item) => (
                    <div key={item.id} className="rounded-md border border-line p-3">
                      <p className="font-medium">{formatDate(item.submitted_at)}</p>
                      <p className="mt-1 text-sm text-muted">
                        {item.stores?.name ?? "Магазин"} · {employeeName(item.employees)}
                      </p>
                      <p className="mt-1 text-sm font-semibold">Средний балл: {Number(item.average_score).toFixed(2)}</p>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="mt-6">
              <SectionHeader icon={ListTodo} title="Ближайшие задачи" action="Все" href="/tasks" />
              <div className="mt-3 divide-y divide-line ui-panel shadow-soft">
                {tasks.length === 0 ? (
                  <p className="p-4 text-sm text-muted">Открытых задач нет.</p>
                ) : (
                  tasks.map((task) => (
                    <div key={task.id} className="flex items-start gap-3 p-4">
                      <CheckCircle2 className="mt-0.5 text-brand" size={18} />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{cleanText(task.title, "Задача с повреждённым текстом")}</p>
                        <p className="mt-1 text-sm text-muted">{formatDate(task.due_at)}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="mt-6">
              <SectionHeader icon={CalendarDays} title="График" action="Посмотреть" href="/schedule" />
              <div className="mt-3 ui-panel p-4">
                <UpcomingScheduleList items={upcomingSchedules} />
              </div>
            </section>
          </>
        ) : storeManagerView ? (
          <>
            <section className="mt-6 ui-panel p-4">
              <SectionHeader icon={ShieldCheck} title="Текущая смена" action="Открыть" href="/shifts" />
              <div className="mt-4 grid gap-3">
                {shiftsResult.data.length === 0 ? (
                  <p className="rounded-md bg-surface p-3 text-sm text-muted">Открытых смен нет.</p>
                ) : (
                  shiftsResult.data.map((shift) => (
                    <div key={shift.id} className="rounded-md border border-line p-3">
                      <p className="font-medium">{shift.stores?.name ?? "Магазин"}</p>
                      <p className="mt-1 text-sm text-muted">{formatDate(shift.shift_date)} · {statusLabels[shift.status] ?? shift.status}</p>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="mt-6">
              <SectionHeader icon={ListTodo} title="Ближайшие задачи" action="Все" href="/tasks" />
              <div className="mt-3 divide-y divide-line ui-panel shadow-soft">
                {tasks.length === 0 ? (
                  <p className="p-4 text-sm text-muted">Открытых задач нет.</p>
                ) : (
                  tasks.map((task) => (
                    <div key={task.id} className="flex items-start gap-3 p-4">
                      <CheckCircle2 className="mt-0.5 text-brand" size={18} />
                      <div className="min-w-0 flex-1">
                    <p className="font-medium">{cleanText(task.title, "Задача с повреждённым текстом")}</p>
                        <p className="mt-1 text-sm text-muted">{formatDate(task.due_at)}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="mt-6">
              <SectionHeader icon={CalendarDays} title="График" action="Посмотреть" href="/schedule" />
              <div className="mt-3 ui-panel p-4">
                <UpcomingScheduleList items={upcomingSchedules} />
              </div>
            </section>
          </>
        ) : supportOnlyView ? (
          <>
            <section className="mt-6">
              <SectionHeader icon={ListTodo} title="Ближайшие задачи" action="Все" href="/tasks" />
              <div className="mt-3 divide-y divide-line ui-panel shadow-soft">
                {tasks.length === 0 ? (
                  <p className="p-4 text-sm text-muted">Открытых задач нет.</p>
                ) : (
                  tasks.map((task) => (
                    <div key={task.id} className="flex items-start gap-3 p-4">
                      <CheckCircle2 className="mt-0.5 text-brand" size={18} />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{cleanText(task.title, "Задача с повреждённым текстом")}</p>
                        <p className="mt-1 text-sm text-muted">{formatDate(task.due_at)}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            {buyerOnlyView || warehouseManagerOnlyView ? (
              <section className="mt-6 ui-panel p-4">
                <SectionHeader icon={PackageSearch} title="Закупки" action="Открыть" href="/procurement" />
                <p className="mt-3 text-sm text-muted">
                  Заказы поставщиков, счета, статусы приемки и проблемные поставки.
                </p>
              </section>
            ) : null}

            <section className="mt-6">
              <SectionHeader icon={CalendarDays} title="График" action="Посмотреть" href="/schedule" />
              <div className="mt-3 ui-panel p-4">
                <UpcomingScheduleList items={upcomingSchedules} />
              </div>
            </section>
          </>
        ) : (
          <>
            {!superAdminView ? (
              <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric icon={ReceiptText} label="К выплате" value={money(payrollPreview)} />
                <Metric icon={ClipboardCheck} label="Чек-лист" value={averageChecklist.toFixed(2)} />
                <Metric icon={ListTodo} label="Задачи" value={`${tasks.length} задач`} />
                <Metric icon={WalletCards} label="Уведомления" value={`${notificationsResult.count ?? 0}`} />
              </section>
            ) : null}

            <section className="mt-6 ui-panel p-4">
          <SectionHeader icon={ShieldCheck} title="Текущая смена" action="Открыть" href="/shifts" />
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <p className="text-muted">Магазин</p>
              <p className="mt-1 font-medium">{activeShift?.stores?.name ?? "Нет смены"}</p>
            </div>
            <div>
              <p className="text-muted">Статус</p>
              <p className="mt-1 font-medium">{activeShift?.status ? statusLabels[activeShift.status] ?? activeShift.status : "—"}</p>
            </div>
            <div>
              <p className="text-muted">Дата</p>
              <p className="mt-1 font-medium">{activeShift?.shift_date ?? "-"}</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <a className="rounded-md bg-brand px-4 py-3 text-center text-sm font-semibold text-white" href="/shifts">
              Смены
            </a>
            <a className="ui-panel px-4 py-3 text-center text-sm font-semibold" href="/shifts/close">
              Закрытие
            </a>
          </div>
            </section>

            <section className="mt-6">
          <SectionHeader icon={ListTodo} title="Ближайшие задачи" action="Все" href="/tasks" />
          <div className="mt-3 divide-y divide-line ui-panel shadow-soft">
            {tasks.length === 0 ? (
              <p className="p-4 text-sm text-muted">Открытых задач нет.</p>
            ) : (
              tasks.map((task) => (
                <div key={task.id} className="flex items-start gap-3 p-4">
                  <CheckCircle2 className="mt-0.5 text-brand" size={18} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{cleanText(task.title, "Задача с повреждённым текстом")}</p>
                    <p className="mt-1 text-sm text-muted">{formatDate(task.due_at)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
            </section>

            <section className="mt-6">
              <SectionHeader icon={CalendarDays} title="График" action="Посмотреть" href="/schedule" />
              <div className="mt-3 ui-panel p-4">
                <UpcomingScheduleList items={upcomingSchedules} />
              </div>
            </section>
          </>
        )}
      </div>
      <BottomNav />
    </main>
  );
}



