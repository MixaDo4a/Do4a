import { ClipboardCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { ChecklistDraft, ChecklistForm } from "@/components/checklist-form";
import { SectionHeader } from "@/components/section-header";
import { CHECKLIST_ROLES, getCurrentRoleCodes, hasAnyRole, RoleRelation, roleCodeFromRelation } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PageProps = { searchParams: Promise<{ message?: string; salary?: string; score?: string }> };
type EmployeeRow = { id: string; full_name: string; employee_status: "padawan" | "experienced"; employee_store_assignments: { store_id: string; valid_from: string; valid_to: string | null }[] };
type ProfileEmployeeRow = { id: string; employee_id: string | null };
type ProfileRoleRow = { profile_id: string; roles: RoleRelation };
type TemplateRow = { id: string; name: string; checklist_items: { id: string; title: string; sort_order: number; store_id: string | null; is_active: boolean; checklist_item_weights: { employee_status: "padawan" | "experienced"; weight_amount: number }[] }[] };
type StoreSettingRow = { store_id: string; item_id: string; is_enabled: boolean; custom_title: string | null; weight_padawan: number; weight_experienced: number };

const messages: Record<string, string> = {
  required: "Выберите магазин, сотрудника и шаблон.",
  "access-error": "Не удалось определить проверяющего.",
  "employee-error": "Выберите менеджера или управляющего, привязанного к магазину.",
  "template-error": "Шаблон чек-листа не найден.",
  "save-error": "Не удалось сохранить чек-лист.",
  saved: "Чек-лист сохранен.",
};

export default async function NewChecklistPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { roles } = await getCurrentRoleCodes();
  if (!hasAnyRole(roles, CHECKLIST_ROLES)) redirect("/");

  const accessibleStores = await getAccessibleStores();
  const accessibleStoreIds = new Set(accessibleStores.map((store) => store.id));
  const [employeesResult, profilesResult, userRolesResult, templatesResult, settingsResult] = await Promise.all([
    supabase.from("employees").select("id, full_name, employee_status, employee_store_assignments(store_id, valid_from, valid_to)").eq("is_active", true).order("full_name").returns<EmployeeRow[]>(),
    supabase.from("profiles").select("id, employee_id").returns<ProfileEmployeeRow[]>(),
    supabase.from("user_roles").select("profile_id, roles(code)").is("revoked_at", null).returns<ProfileRoleRow[]>(),
    supabase.from("checklist_templates").select("id, name, checklist_items(id, title, sort_order, store_id, is_active, checklist_item_weights(employee_status, weight_amount))").eq("is_active", true).order("version", { ascending: false }).limit(1).returns<TemplateRow[]>(),
    accessibleStores.length > 0
      ? supabase.from("store_checklist_item_settings").select("store_id, item_id, is_enabled, custom_title, weight_padawan, weight_experienced").in("store_id", [...accessibleStoreIds]).returns<StoreSettingRow[]>()
      : Promise.resolve({ data: [] as StoreSettingRow[], error: null }),
  ]);
  if (employeesResult.error) throw new Error(employeesResult.error.message);
  if (profilesResult.error) throw new Error(profilesResult.error.message);
  if (userRolesResult.error) throw new Error(userRolesResult.error.message);
  if (templatesResult.error) throw new Error(templatesResult.error.message);
  if (settingsResult.error) throw new Error(settingsResult.error.message);

  const profileIdByEmployeeId = new Map(profilesResult.data.map((profile) => [profile.employee_id ?? "", profile.id]));
  const currentEmployeeId = profilesResult.data.find((profile) => profile.id === user.id)?.employee_id;
  const eligibleProfileIds = new Set(userRolesResult.data
    .filter((row) => ["manager", "store_manager"].includes(roleCodeFromRelation(row.roles) ?? ""))
    .map((row) => row.profile_id));
  const storeManagerProfileIds = new Set(userRolesResult.data
    .filter((row) => roleCodeFromRelation(row.roles) === "store_manager")
    .map((row) => row.profile_id));
  const today = new Date().toISOString().slice(0, 10);
  const eligibleEmployees = employeesResult.data
    .filter((employee) => eligibleProfileIds.has(profileIdByEmployeeId.get(employee.id) ?? "")
      && !(roles.includes("store_manager") && employee.id === currentEmployeeId))
    .map((employee) => ({
      ...employee,
      roleLabel: storeManagerProfileIds.has(profileIdByEmployeeId.get(employee.id) ?? "") ? "Управляющий" : "Менеджер",
      storeIds: employee.employee_store_assignments
        .filter((assignment) => accessibleStoreIds.has(assignment.store_id)
          && assignment.valid_from <= today && (!assignment.valid_to || assignment.valid_to >= today))
        .map((assignment) => assignment.store_id),
    }))
    .filter((employee) => employee.storeIds.length > 0);
  const template = templatesResult.data[0];
  const items = [...(template?.checklist_items ?? [])]
    .filter((item) => !item.store_id || accessibleStoreIds.has(item.store_id))
    .sort((left, right) => left.sort_order - right.sort_order);
  const draftsResult = template
    ? await supabase.from("checklist_drafts").select("template_id, store_id, employee_id, payload").eq("profile_id", user.id).eq("template_id", template.id).returns<ChecklistDraft[]>()
    : { data: [], error: null };
  if (draftsResult.error) throw new Error(draftsResult.error.message);
  const message = params.message ? messages[params.message] : null;
  const canSubmit = accessibleStores.length > 0 && eligibleEmployees.length > 0 && Boolean(template) && items.length > 0;

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-4xl">
        <SectionHeader icon={ClipboardCheck} title="Чек-лист" showBack />
        {message ? <p className="mt-4 ui-panel p-3 text-sm text-muted">{message}{params.salary && params.score ? ` Средний балл: ${params.score}. Оклад за смену: ${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Number(params.salary))} руб.` : ""}</p> : null}
        <ChecklistForm canSubmit={canSubmit} drafts={draftsResult.data ?? []} employees={eligibleEmployees} items={items} settings={settingsResult.data ?? []} stores={accessibleStores} templateId={template?.id ?? ""} templateName={template?.name ?? "Шаблон не найден"} />
      </div>
      <BottomNav />
    </main>
  );
}
