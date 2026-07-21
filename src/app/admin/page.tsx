import { CalendarPlus, Settings, Store, UserPlus, WalletCards } from "lucide-react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { BottomNav } from "@/components/bottom-nav";
import { EmployeeRoleStatusFields } from "@/components/employee-role-status-fields";
import { SectionHeader } from "@/components/section-header";
import { canDeleteTargetRole, DEDUCTION_ROLES, getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES, ROLE_HIERARCHY, RoleRelation, roleCodeFromRelation, roleRank } from "@/lib/auth/roles";
import { getAccessibleStores, getCurrentEmployeeScope } from "@/lib/auth/stores";
import { employeeName } from "@/lib/display";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<{ message?: string; detail?: string; month?: string; storeId?: string }>;
};

type StoreRow = {
  id: string;
  city: string;
  name: string;
  address: string | null;
  workday_start_time: string | null;
  workday_end_time: string | null;
  status: string;
};

type EmployeeRow = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  telegram_username: string | null;
  city: string | null;
  primary_store_id: string | null;
  employee_status: "padawan" | "experienced";
  is_active: boolean;
  stores: { name: string } | null;
  employee_store_assignments: { store_id: string; is_primary: boolean; stores: { name: string; city: string } | null }[];
};

type RoleRow = {
  code: "manager" | "auditor" | "store_manager" | "warehouse_manager" | "warehouse_assistant" | "super_admin" | "developer";
  name: string;
};

type ProfileRoleRow = {
  profile_id: string;
  roles: RoleRelation<RoleRow["code"]>;
};

type ProfileEmployeeRow = {
  id: string;
  employee_id: string | null;
};

type ScheduleRow = {
  id: string;
  store_id: string;
  employee_id: string;
  status: string;
  shift_date: string;
  stores: { id: string; name: string; city: string } | null;
};

type StorePlanRow = {
  id: string;
  store_id: string;
  period_start: string;
  period_end: string;
  sales_plan_amount: number | string;
};

type PayrollAdjustmentRow = {
  id: string;
  employee_id: string;
  period_month: string;
  adjustment_type: string;
  amount: number | string;
  reason: string;
};

type ScheduleCell = {
  date: string;
  label: string;
  dayName: string;
};

type EmployeeLookupRow = {
  id: string;
  full_name: string;
};

const messages: Record<string, string> = {
  "store-created": "Магазин создан.",
  "employee-created": "Сотрудник создан.",
  "schedule-created": "График сохранён.",
  "store-plan-saved": "План магазина сохранён.",
  "payroll-adjustment-saved": "Корректировка зарплаты сохранена.",
  "store-updated": "Магазин обновлён.",
  "employee-updated": "Сотрудник обновлён.",
  "employee-deleted": "Сотрудник удалён.",
  "employee-restored": "Сотрудник восстановлен.",
  "store-archived": "Магазин скрыт.",
  "store-restored": "Магазин восстановлен.",
  "admin-required": "Недостаточно прав.",
  "admin-error": "Что-то пошло не так.",
};

const employeeStatusLabels: Record<EmployeeRow["employee_status"], string> = {
  padawan: "Падаван",
  experienced: "Бывалый",
};

const roleHierarchy: RoleRow["code"][] = [...ROLE_HIERARCHY];

const roleLabels: Record<RoleRow["code"], string> = {
  manager: "Менеджер",
  auditor: "Проверяющий",
  store_manager: "Управляющий",
  warehouse_manager: "Кладовщик",
  warehouse_assistant: "Помощник кладовщика",
  super_admin: "Супер-админ",
  developer: "Разработчик",
};

const dayStatusLabels: Record<string, string> = {
  planned: "Р1",
  planned_secondary: "Р2",
  day_off: "В",
  sick_leave: "Б",
  vacation: "О",
};

const adjustmentTypeLabels: Record<string, string> = {
  bonus: "Премия",
  fine: "Штраф",
  inventory: "Инвентаризация",
  expiration: "Просрочка",
  product: "Под З/П",
};

const adjustmentTypeDirections: Record<string, "plus" | "minus"> = {
  bonus: "plus",
  fine: "minus",
  inventory: "minus",
  expiration: "minus",
  product: "minus",
};

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

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

function monthLabel(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(new Date(`${value}-01T00:00:00Z`));
}

export default async function AdminPage({ searchParams }: PageProps) {
  const { message, detail, month, storeId: selectedStoreParam } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { roles } = await getCurrentRoleCodes();

  if (!hasAnyRole(roles, DEDUCTION_ROLES)) {
    redirect("/");
  }
  const fullAdminView = hasAnyRole(roles, MANAGE_ROLES);
  const warehouseManagerOnly = roles.includes("warehouse_manager") && !fullAdminView;

  const [accessibleStores, currentScope] = await Promise.all([getAccessibleStores(), getCurrentEmployeeScope()]);
  const accessibleStoreIds = accessibleStores.map((store) => store.id);

  const storesResult = accessibleStoreIds.length > 0
    ? await supabase
        .from("stores")
        .select("id, city, name, address, workday_start_time, workday_end_time, status")
        .in("id", accessibleStoreIds)
        .order("city")
        .order("name")
        .returns<StoreRow[]>()
    : { data: [] as StoreRow[], error: null as null };

  const [employeesResult, schedulesResult, storePlansResult, adjustmentsResult, employeeLookupResult, rolesResult, profilesResult, userRolesResult] =
    await Promise.all([
    supabase
      .from("employees")
      .select("id, full_name, phone, email, telegram_username, city, primary_store_id, employee_status, is_active, stores(name), employee_store_assignments(store_id, is_primary, stores(name, city))")
      .order("full_name")
      .returns<EmployeeRow[]>(),
    supabase
      .from("schedules")
      .select("id, store_id, employee_id, status, shift_date, stores(id, name, city)")
      .order("shift_date", { ascending: true })
      .limit(500)
      .returns<ScheduleRow[]>(),
    supabase
      .from("store_sales_plans")
      .select("id, store_id, period_start, period_end, sales_plan_amount")
      .order("period_start", { ascending: false })
      .limit(12)
      .returns<StorePlanRow[]>(),
    supabase
      .from("payroll_adjustments")
      .select("id, employee_id, period_month, adjustment_type, amount, reason")
      .order("period_month", { ascending: false })
      .limit(12)
      .returns<PayrollAdjustmentRow[]>(),
    supabase.from("employees").select("id, full_name").eq("is_active", true).returns<EmployeeLookupRow[]>(),
    fullAdminView ? supabase.from("roles").select("code, name").returns<RoleRow[]>() : Promise.resolve({ data: [] as RoleRow[], error: null }),
    fullAdminView ? supabase.from("profiles").select("id, employee_id").returns<ProfileEmployeeRow[]>() : Promise.resolve({ data: [] as ProfileEmployeeRow[], error: null }),
    fullAdminView
      ? supabase.from("user_roles").select("profile_id, roles(code, name)").is("revoked_at", null).returns<ProfileRoleRow[]>()
      : Promise.resolve({ data: [] as ProfileRoleRow[], error: null }),
  ]);

  if (employeesResult.error) {
    throw new Error(employeesResult.error.message);
  }

  if (schedulesResult.error) {
    throw new Error(schedulesResult.error.message);
  }

  if (storePlansResult.error) {
    throw new Error(storePlansResult.error.message);
  }

  if (adjustmentsResult.error) {
    throw new Error(adjustmentsResult.error.message);
  }

  if (employeeLookupResult.error) {
    throw new Error(employeeLookupResult.error.message);
  }

  if (rolesResult.error) {
    throw new Error(rolesResult.error.message);
  }

  if (profilesResult.error) {
    throw new Error(profilesResult.error.message);
  }

  if (userRolesResult.error) {
    throw new Error(userRolesResult.error.message);
  }

  if (storesResult.error) {
    throw new Error(storesResult.error.message);
  }

  const stores = storesResult.data;
  const accessibleStoreIdSet = new Set(accessibleStoreIds);
  const currentCity = currentScope.city?.trim().toLowerCase() ?? "";
  const employees = currentScope.isDeveloper
    ? employeesResult.data
    : employeesResult.data.filter((employee) => {
        if (!employee.is_active) return false;
        const employeeCity = employee.city?.trim().toLowerCase() ?? "";
        const sameCity = !currentCity || employeeCity === currentCity;
        const hasAccessibleStore = employee.employee_store_assignments.some((assignment) => accessibleStoreIdSet.has(assignment.store_id));
        return sameCity && hasAccessibleStore;
      });
  const visibleEmployeeIds = new Set(employees.map((employee) => employee.id));
  const storePlans = storePlansResult.data.filter((plan) => accessibleStoreIdSet.has(plan.store_id));
  const payrollAdjustments = adjustmentsResult.data.filter((adjustment) => visibleEmployeeIds.has(adjustment.employee_id));
  const employeeNameById = new Map(employeeLookupResult.data.filter((employee) => visibleEmployeeIds.has(employee.id)).map((employee) => [employee.id, employee.full_name]));
  const profileIdByEmployeeId = new Map(profilesResult.data.map((profile) => [profile.employee_id ?? "", profile.id]));
  const roleByProfileId = new Map(userRolesResult.data.map((row) => [row.profile_id, roleCodeFromRelation(row.roles)]));
  const roleByEmployeeId = new Map(
    profilesResult.data.map((profile) => [profile.employee_id ?? "", roleByProfileId.get(profile.id) ?? null]),
  );
  const currentRoleCode = [...ROLE_HIERARCHY].find((code) => roles.includes(code)) ?? null;
  const activeStores = stores.filter((storeItem) => storeItem.status === "active");
  const activeEmployees = employees.filter((employee) => employee.is_active);
  const selectedStoreId = selectedStoreParam && activeStores.some((store) => store.id === selectedStoreParam)
    ? selectedStoreParam
    : activeStores[0]?.id ?? "";
  const selectedStoreEmployees = activeEmployees.filter((employee) =>
    employee.employee_store_assignments.some((assignment) => assignment.store_id === selectedStoreId),
  );
  const scheduleEmployees = selectedStoreEmployees.slice(0, 8);
  const canCreateStore = roles.some((role) => ["super_admin", "developer"].includes(role));
  const canRunNotificationCron = roles.some((role) => ["super_admin", "developer"].includes(role));
  const canEditAuthAccount = roles.some((role) => ["super_admin", "developer"].includes(role));
  const selectedMonth = monthStart(month);
  const selectedMonthEnd = monthEnd(selectedMonth);
  const scheduleDates: ScheduleCell[] = [];
  for (let day = 1; day <= new Date(`${selectedMonthEnd}T00:00:00Z`).getUTCDate(); day += 1) {
    const current = new Date(`${selectedMonth.slice(0, 7)}-${String(day).padStart(2, "0")}T00:00:00Z`);
    scheduleDates.push({
      date: current.toISOString().slice(0, 10),
      label: String(day).padStart(2, "0"),
      dayName: new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(current),
    });
  }

  const monthlySchedules = schedulesResult.data.filter(
    (schedule) =>
      schedule.shift_date >= selectedMonth &&
      schedule.shift_date <= selectedMonthEnd &&
      schedule.store_id === selectedStoreId,
  );
  const storeSchedule = new Map<string, ScheduleRow>();
  monthlySchedules.forEach((schedule) => {
    storeSchedule.set(`${schedule.employee_id}_${schedule.shift_date}`, schedule);
  });

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-5xl">
        <SectionHeader icon={Settings} title="Управление" showBack />

        {message ? (
          <p className="mt-4 ui-panel p-3 text-sm text-muted shadow-soft">
            {messages[message] ?? message}
            {detail ? <span className="mt-1 block text-xs text-brand">{detail}</span> : null}
          </p>
        ) : null}

        {canRunNotificationCron ? (
          <form action="/api/cron/notifications" className="mt-4 flex justify-end" method="post">
              <button className="h-10 ui-panel px-4 text-sm font-semibold text-ink shadow-soft">
                Запустить уведомления
              </button>
          </form>
        ) : null}

        <section className="mt-4 grid gap-4">
          {!warehouseManagerOnly ? (
          <form action="/admin/store-plans/save" className="ui-panel p-4" method="post">
            <h2 className="inline-flex items-center gap-2 font-semibold">
              <Store className="text-brand" size={18} /> План магазина
            </h2>
            <div className="mt-4 grid gap-3">
              <select className="h-11 rounded-md border border-line px-3" name="store_id" defaultValue={selectedStoreId}>
                {activeStores.map((storeItem) => (
                  <option key={storeItem.id} value={storeItem.id}>
                    {storeItem.name}, {storeItem.city}
                  </option>
                ))}
              </select>
                <input className="h-11 rounded-md border border-line px-3" name="month" type="month" defaultValue={selectedMonth.slice(0, 7)} />
                <input className="h-11 rounded-md border border-line px-3" min="0" name="sales_plan_amount" placeholder="Сумма плана" type="number" />
              <button className="h-11 rounded-md bg-brand px-4 font-semibold text-white">Сохранить план</button>
            </div>
          </form>
          ) : null}

          <form action="/admin/payroll-adjustments/create" className="ui-panel p-4" method="post">
            <h2 className="inline-flex items-center gap-2 font-semibold">
              <WalletCards className="text-brand" size={18} /> {warehouseManagerOnly ? "Вычеты" : "Премии и вычеты"}
            </h2>
            <div className="mt-4 grid gap-3">
              <select className="h-11 rounded-md border border-line px-3" name="employee_id" defaultValue="">
                <option value="">Сотрудник</option>
                {activeEmployees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employeeName(employee)}
                  </option>
                ))}
              </select>
              <input className="h-11 rounded-md border border-line px-3" name="month" type="month" defaultValue={selectedMonth.slice(0, 7)} />
              <div className="grid gap-2">
                <select className="h-11 rounded-md border border-line px-3" name="adjustment_type" defaultValue={warehouseManagerOnly ? "fine" : "bonus"}>
                  {Object.entries(adjustmentTypeLabels).filter(([value]) => !warehouseManagerOnly || value !== "bonus").map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <input className="h-11 rounded-md border border-line px-3" min="0" name="amount" placeholder="Сумма" type="number" />
              </div>
              <input className="h-11 rounded-md border border-line px-3" name="reason" placeholder="Комментарий" />
              <button className="h-11 rounded-md bg-brand px-4 font-semibold text-white">Сохранить корректировку</button>
            </div>
          </form>
        </section>

        <section className="mt-6 grid gap-4">
          {!warehouseManagerOnly ? (
          <div className="ui-panel p-4">
            <h2 className="font-semibold">Последние планы магазинов</h2>
            <div className="mt-3 max-h-[170px] grid gap-2 overflow-y-auto pr-1">
              {storePlans.length === 0 ? <p className="text-sm text-muted">Планов пока нет.</p> : null}
              {storePlans.map((plan) => (
                <div key={plan.id} className="rounded-md bg-surface p-3 text-sm">
                  <p className="font-semibold">
                    {stores.find((store) => store.id === plan.store_id)?.name ?? "Магазин"}
                  </p>
                  <p className="text-muted">
                    {plan.period_start.slice(0, 7)} · {Number(plan.sales_plan_amount).toLocaleString("ru-RU")} руб.
                  </p>
                </div>
              ))}
            </div>
          </div>
          ) : null}

          <div className="ui-panel p-4">
            <h2 className="font-semibold">Последние корректировки</h2>
            <div className="mt-3 max-h-[170px] grid gap-2 overflow-y-auto pr-1">
              {payrollAdjustments.length === 0 ? <p className="text-sm text-muted">Корректировок пока нет.</p> : null}
              {payrollAdjustments.map((item) => (
                <div key={item.id} className="rounded-md bg-surface p-3 text-sm">
                  <p className="font-semibold">
                    {employeeNameById.get(item.employee_id) ?? "Сотрудник"}
                  </p>
                  <p className="text-muted">
                    {item.period_month.slice(0, 7)} · {adjustmentTypeLabels[item.adjustment_type] ?? item.adjustment_type} ·{" "}
                    {adjustmentTypeDirections[item.adjustment_type] === "plus" ? "+" : "-"}
                    {Number(item.amount).toLocaleString("ru-RU")} руб.
                  </p>
                  <p className="mt-1 text-xs text-muted">{item.reason}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {!warehouseManagerOnly ? (
        <section className="mt-4 grid gap-4">
          <div className="ui-panel p-4">
            <SectionHeader icon={Store} title="Магазины" action="Открыть" href="/admin/stores" />
            <p className="mt-3 text-sm text-muted">Создание и редактирование магазинов перенесено в отдельный раздел.</p>
          </div>
          <div className="ui-panel p-4">
            <SectionHeader icon={UserPlus} title="Сотрудники" action="Открыть" href="/admin/employees" />
            <p className="mt-3 text-sm text-muted">Создание и редактирование сотрудников перенесено в отдельный раздел.</p>
          </div>
        </section>
        ) : null}

        {!warehouseManagerOnly ? (
        <section className="mt-6 ui-panel p-4">
          <SectionHeader icon={CalendarPlus} title="График работы" action="Редактировать" href="/admin/schedule" />
          <p className="mt-3 text-sm text-muted">
            График вынесен в отдельный редактор с горизонтальной таблицей. В списке сотрудников будут только те, у кого есть доступ к выбранному магазину.
          </p>
        </section>
        ) : null}

        {!warehouseManagerOnly ? (
        <section className="mt-6 grid gap-4">
          <div className="ui-panel p-4">
            <SectionHeader icon={Store} title="Магазины" action="Открыть" href="/admin/stores" />
            <div className="mt-3 grid gap-3">
              {stores.map((storeItem) => (
                <details key={storeItem.id} className="rounded-md border border-line bg-surface p-3 text-sm">
                  <summary className="cursor-pointer list-none font-semibold">
                    {storeItem.name} · {storeItem.city}
                    {storeItem.status === "archived" ? <span className="ml-2 text-xs text-brand">Удалён</span> : null}
                  </summary>
                  <form action="/admin/stores/update" className="mt-3 grid gap-2" method="post">
                    <input name="store_id" type="hidden" value={storeItem.id} />
                    <input className="h-10 rounded-md border border-line px-3" name="city" defaultValue={storeItem.city} />
                    <input className="h-10 rounded-md border border-line px-3" name="name" defaultValue={storeItem.name} />
                    <input className="h-10 rounded-md border border-line px-3" name="address" defaultValue={storeItem.address ?? ""} placeholder="Адрес" />
                    <div className="grid gap-2">
                      <input className="h-10 rounded-md border border-line px-3" defaultValue={storeItem.workday_start_time ?? ""} name="start_time" type="time" />
                      <input className="h-10 rounded-md border border-line px-3" defaultValue={storeItem.workday_end_time ?? ""} name="end_time" type="time" />
                    </div>
                    <select className="h-10 rounded-md border border-line px-3" name="status" defaultValue={storeItem.status}>
                      {currentScope.isDeveloper ? (
                        <>
                          <option value="active">Активен</option>
                          <option value="archived">Архив</option>
                        </>
                      ) : (
                        <option value={storeItem.status}>Активен</option>
                      )}
                    </select>
                    <button className="h-10 rounded-md bg-brand px-4 font-semibold text-white">Сохранить магазин</button>
                  </form>
                  {currentScope.isDeveloper && storeItem.status === "active" ? (
                    <form action="/admin/stores/delete" className="mt-2" method="post">
                      <input name="store_id" type="hidden" value={storeItem.id} />
                      <button className="h-10 w-full rounded-md border border-rose-500 bg-white px-4 font-semibold text-rose-600" type="submit">
                        Скрыть магазин
                      </button>
                    </form>
                  ) : null}
                  {currentScope.isDeveloper && storeItem.status === "archived" ? (
                    <form action="/admin/stores/restore" className="mt-2" method="post">
                      <input name="store_id" type="hidden" value={storeItem.id} />
                      <button className="h-10 w-full rounded-md border border-emerald-500 bg-white px-4 font-semibold text-emerald-700" type="submit">
                        Восстановить магазин
                      </button>
                    </form>
                  ) : null}
                </details>
              ))}
            </div>
          </div>

          <div className="ui-panel p-4">
            <SectionHeader icon={UserPlus} title="Сотрудники" action="Открыть" href="/admin/employees" />
            <div className="mt-3 grid gap-3">
              {employees.map((employee) => (
                <details key={employee.id} className="rounded-md border border-line bg-surface p-3 text-sm">
                  <summary className="cursor-pointer list-none font-semibold">
                    {employeeName(employee)}
                    {roleByEmployeeId.get(employee.id) === "manager" ? ` · ${employeeStatusLabels[employee.employee_status]}` : ""}
                    {!employee.is_active ? <span className="ml-2 text-xs text-brand">Удалён</span> : null}
                  </summary>
                  <form action="/admin/employees/update" className="mt-3 grid gap-2" method="post">
                    <input name="employee_id" type="hidden" value={employee.id} />
                    <input className="h-10 rounded-md border border-line px-3" name="full_name" defaultValue={employee.full_name} />
                    <input className="h-10 rounded-md border border-line px-3" name="phone" defaultValue={employee.phone ?? ""} placeholder="Телефон" />
                    <input
                      className="h-10 rounded-md border border-line px-3"
                      name="email"
                      defaultValue={employee.email ?? ""}
                      placeholder="Логин / Email"
                      readOnly={!canEditAuthAccount}
                    />
                    {canEditAuthAccount ? <input className="h-10 rounded-md border border-line px-3" name="new_password" placeholder="Новый пароль" type="password" /> : null}
                    <input className="h-10 rounded-md border border-line px-3" name="telegram_username" defaultValue={employee.telegram_username ?? ""} placeholder="Telegram username" />
                    <input className="h-10 rounded-md border border-line px-3" name="city" defaultValue={employee.city ?? ""} placeholder="Город" />
                    {currentRoleCode ? (
                      <EmployeeRoleStatusFields
                        assignableRoleCodes={roleHierarchy.filter((code) => roleRank(code) >= roleRank(currentRoleCode))}
                        currentRoleCode={roleByEmployeeId.get(employee.id)}
                        defaultStatus={employee.employee_status}
                        keepCurrentOption
                        roleLabels={roleLabels}
                      />
                    ) : (
                      <input name="employee_status" type="hidden" value={employee.employee_status} />
                    )}
                    <div className="grid gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted">Магазины доступа</span>
                        <Link className="text-xs font-semibold text-brand underline-offset-4 hover:underline" href="/admin/stores">
                          Открыть магазины
                        </Link>
                      </div>
                      <div className="grid gap-2 ui-panel p-3">
                        {activeStores.map((storeItem) => {
                          const checked = employee.employee_store_assignments.some((assignment) => assignment.store_id === storeItem.id);
                          return (
                            <label key={storeItem.id} className="flex items-center gap-2 text-sm">
                              <input defaultChecked={checked} name="store_ids" type="checkbox" value={storeItem.id} />
                              <span>
                                {storeItem.name}, {storeItem.city}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-muted">
                      <input name="is_active" type="checkbox" defaultChecked={employee.is_active} value="true" />
                      Активен
                    </label>
                    <button className="h-10 rounded-md bg-brand px-4 font-semibold text-white">Сохранить сотрудника</button>
                  </form>
                  {employee.is_active &&
                  currentRoleCode &&
                  roleByEmployeeId.get(employee.id) &&
                  canDeleteTargetRole(currentRoleCode, roleByEmployeeId.get(employee.id) ?? "") ? (
                    <form action="/admin/employees/delete" className="mt-2" method="post">
                      <input name="employee_id" type="hidden" value={employee.id} />
                      <button className="h-10 w-full rounded-md border border-rose-500 bg-white px-4 font-semibold text-rose-600" type="submit">
                        Удалить сотрудника
                      </button>
                    </form>
                  ) : null}
                  {!employee.is_active && currentScope.isDeveloper ? (
                    <form action="/admin/employees/restore" className="mt-2" method="post">
                      <input name="employee_id" type="hidden" value={employee.id} />
                      <button className="h-10 w-full rounded-md border border-emerald-500 bg-white px-4 font-semibold text-emerald-700" type="submit">
                        Восстановить сотрудника
                      </button>
                    </form>
                  ) : null}
                </details>
              ))}
            </div>
          </div>

        </section>
        ) : null}
      </div>
      <BottomNav />
    </main>
  );
}







