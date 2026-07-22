import { Settings, UserPlus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { EmployeeRoleStatusFields } from "@/components/employee-role-status-fields";
import { SectionHeader } from "@/components/section-header";
import { getAccessibleStores, getCurrentEmployeeScope } from "@/lib/auth/stores";
import { employeeName } from "@/lib/display";
import { canDeleteTargetRole, getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES, ROLE_HIERARCHY, RoleRelation, roleCodeFromRelation, roleRank } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type StoreRow = { id: string; name: string; city: string };
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
type RoleRow = { code: "manager" | "auditor" | "store_manager" | "buyer" | "warehouse_manager" | "warehouse_assistant" | "super_admin" | "developer"; name: string };
type ProfileRoleRow = { profile_id: string; roles: RoleRelation<RoleRow["code"]> };
type ProfileEmployeeRow = { id: string; employee_id: string | null };
type PageProps = {
  searchParams: Promise<{
    message?: string;
    detail?: string;
  }>;
};

const roleHierarchy: RoleRow["code"][] = [...ROLE_HIERARCHY];
const roleLabels: Record<RoleRow["code"], string> = {
  manager: "Менеджер",
  auditor: "Проверяющий",
  store_manager: "Управляющий",
  buyer: "Закупщик",
  warehouse_manager: "Кладовщик",
  warehouse_assistant: "Помощник кладовщика",
  super_admin: "Супер-админ",
  developer: "Разработчик",
};
const employeeStatusLabels: Record<EmployeeRow["employee_status"], string> = {
  padawan: "Падаван",
  experienced: "Бывалый",
};
const pageMessages: Record<string, string> = {
  "admin-required": "Заполните все обязательные поля.",
  "admin-error": "Не удалось сохранить данные.",
  "employee-created": "Сотрудник создан.",
  "employee-updated": "Сотрудник обновлён.",
  "employee-deleted": "Сотрудник удалён.",
  "employee-restored": "Сотрудник восстановлен.",
};

export default async function AdminEmployeesPage({ searchParams }: PageProps) {
  const { message, detail } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { roles } = await getCurrentRoleCodes();
  if (!hasAnyRole(roles, MANAGE_ROLES)) redirect("/");

  const [accessibleStores, currentScope] = await Promise.all([getAccessibleStores(), getCurrentEmployeeScope()]);

  const [employeesResult, profilesResult, userRolesResult] = await Promise.all([
    supabase
      .from("employees")
      .select(
        "id, full_name, phone, email, telegram_username, city, primary_store_id, employee_status, is_active, stores(name), employee_store_assignments(store_id, is_primary, stores(name, city))",
      )
      .order("full_name")
      .returns<EmployeeRow[]>(),
    supabase.from("profiles").select("id, employee_id").returns<ProfileEmployeeRow[]>(),
    supabase.from("user_roles").select("profile_id, roles(code, name)").is("revoked_at", null).returns<ProfileRoleRow[]>(),
  ]);

  if (employeesResult.error) throw new Error(employeesResult.error.message);
  if (profilesResult.error) throw new Error(profilesResult.error.message);
  if (userRolesResult.error) throw new Error(userRolesResult.error.message);

  const activeStores = accessibleStores;
  const accessibleStoreIds = new Set(activeStores.map((store) => store.id));
  const currentCity = currentScope.city?.trim().toLowerCase() ?? "";
  const employees = currentScope.isDeveloper
    ? employeesResult.data
    : employeesResult.data.filter((employee) => {
        if (!employee.is_active) return false;
        const employeeCity = employee.city?.trim().toLowerCase() ?? "";
        const sameCity = !currentCity || employeeCity === currentCity;
        const hasAccessibleStore = employee.employee_store_assignments.some((assignment) => accessibleStoreIds.has(assignment.store_id));
        return sameCity && hasAccessibleStore;
      });
  const profileIdByEmployeeId = new Map(profilesResult.data.map((profile) => [profile.employee_id ?? "", profile.id]));
  const roleByProfileId = new Map(userRolesResult.data.map((row) => [row.profile_id, roleCodeFromRelation(row.roles)]));
  const roleByEmployeeId = new Map(
    profilesResult.data.map((profile) => [profile.employee_id ?? "", roleByProfileId.get(profile.id) ?? null]),
  );
  const currentRoleCode = [...ROLE_HIERARCHY].find((code) => roles.includes(code)) ?? null;
  const canEditAuthAccount = roles.some((role) => ["super_admin", "developer"].includes(role));
  const assignableRoleCodes = currentRoleCode ? roleHierarchy.filter((code) => roleRank(code) >= roleRank(currentRoleCode)) : [];

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-5xl">
        <SectionHeader icon={Settings} title="Управление" showBack />
        {message ? (
          <div className="mt-4 ui-panel p-3 text-sm text-muted">
            <p className="font-semibold text-ink">{pageMessages[message] ?? message}</p>
            {detail ? <p className="mt-1 text-xs text-brand">{detail}</p> : null}
          </div>
        ) : null}

        <section className="mt-4 ui-panel p-4">
          <SectionHeader icon={UserPlus} title="Создать сотрудника" />
          <form action="/admin/employees/create" className="mt-4 grid gap-2" method="post">
            <input className="h-10 rounded-md border border-line px-3" name="full_name" placeholder="Имя" required />
            <input className="h-10 rounded-md border border-line px-3" name="phone" placeholder="Телефон" required />
            <input className="h-10 rounded-md border border-line px-3" name="email" placeholder="Email / логин" required />
            <input className="h-10 rounded-md border border-line px-3" name="telegram_username" placeholder="Telegram username" required />
            <input className="h-10 rounded-md border border-line px-3" name="city" placeholder="Город" required />
            <EmployeeRoleStatusFields assignableRoleCodes={assignableRoleCodes} defaultStatus="padawan" roleLabels={roleLabels} />
            <p className="text-xs text-muted">Пароль для всех тестовых учёток: Do4aTest345</p>
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted">Магазины доступа</span>
                <Link className="text-xs font-semibold text-brand underline-offset-4 hover:underline" href="/admin/stores">
                  Открыть магазины
                </Link>
              </div>
              <div className="grid gap-2 ui-panel p-3">
                {activeStores.map((storeItem) => (
                  <label key={storeItem.id} className="flex items-center gap-2 text-sm">
                    <input name="store_ids" type="checkbox" value={storeItem.id} />
                    <span>
                      {storeItem.name}, {storeItem.city}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted">
              <input defaultChecked name="is_active" type="checkbox" value="true" />
              Активен
            </label>
            <button className="h-10 rounded-md bg-brand px-4 font-semibold text-white">Создать сотрудника</button>
          </form>
        </section>

        <section className="mt-4 ui-panel p-4">
          <SectionHeader icon={UserPlus} title="Все сотрудники" />
          <div className="mt-4 grid gap-3">
            {employees.map((employee) => (
              <details key={employee.id} className="rounded-md border border-line bg-surface p-3 text-sm">
                <summary className="cursor-pointer list-none font-semibold">
                  {employeeName(employee)}
                  {roleByEmployeeId.get(employee.id) === "manager" ? ` · ${employeeStatusLabels[employee.employee_status]}` : ""}
                  {!employee.is_active ? <span className="ml-2 text-xs text-brand">Удалён</span> : null}
                </summary>
                <form action="/admin/employees/update" className="mt-3 grid gap-2" method="post">
                  <input name="employee_id" type="hidden" value={employee.id} />
                  <input
                    name="current_employee_role"
                    type="hidden"
                    value={profileIdByEmployeeId.get(employee.id) ? roleByProfileId.get(profileIdByEmployeeId.get(employee.id) ?? "") ?? "" : ""}
                  />
                  <input className="h-10 rounded-md border border-line px-3" name="full_name" defaultValue={employee.full_name} />
                  <input className="h-10 rounded-md border border-line px-3" name="phone" defaultValue={employee.phone ?? ""} placeholder="Телефон" required />
                  <input
                    className="h-10 rounded-md border border-line px-3"
                    name="email"
                    defaultValue={employee.email ?? ""}
                    placeholder="Логин / Email"
                    readOnly={!canEditAuthAccount}
                  />
                  {canEditAuthAccount ? <input className="h-10 rounded-md border border-line px-3" name="new_password" placeholder="Новый пароль" type="password" /> : null}
                  <input className="h-10 rounded-md border border-line px-3" name="telegram_username" defaultValue={employee.telegram_username ?? ""} placeholder="Telegram username" required />
                  <input className="h-10 rounded-md border border-line px-3" name="city" defaultValue={employee.city ?? ""} placeholder="Город" required />
                  {currentRoleCode ? (
                    <EmployeeRoleStatusFields
                      assignableRoleCodes={assignableRoleCodes}
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
                (currentRoleCode === "developer" || canDeleteTargetRole(currentRoleCode, roleByEmployeeId.get(employee.id) ?? "")) ? (
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
        </section>
      </div>
      <BottomNav />
    </main>
  );
}




