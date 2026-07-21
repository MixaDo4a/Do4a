import { NextRequest, NextResponse } from "next/server";
import { canDeleteTargetRole, canManageTargetRole, getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { getAccessibleStores, getCurrentEmployeeScope } from "@/lib/auth/stores";
import { appRedirectUrl } from "@/lib/http/redirect-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RoleCode = "manager" | "auditor" | "store_manager" | "warehouse_manager" | "warehouse_assistant" | "super_admin" | "developer";
type ProfileRow = { id: string; employee_id: string | null };
type UserRoleRow = { roles: { code: RoleCode } | null };
type TargetEmployeeRow = {
  city: string | null;
  is_active: boolean;
  employee_store_assignments: { store_id: string }[];
};

function adminUrl(request: NextRequest, message: string, detail?: string) {
  const url = appRedirectUrl(request, "/admin/employees");
  url.searchParams.set("message", message);
  if (detail) url.searchParams.set("detail", detail);
  return url;
}

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function values(formData: FormData, key: string) {
  return formData
    .getAll(key)
    .map((item) => String(item).trim())
    .filter(Boolean);
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const employeeId = value(formData, "employee_id");
  const fullName = value(formData, "full_name");
  const phone = value(formData, "phone");
  const email = value(formData, "email").toLowerCase();
  const telegramUsername = value(formData, "telegram_username").replace(/^@/, "");
  const city = value(formData, "city");
  const employeeStatus = value(formData, "employee_status");
  const storeIds = values(formData, "store_ids");
  const primaryStoreId = storeIds[0] ?? "";
  const employeeRole = value(formData, "employee_role") as RoleCode | "";
  const newPassword = value(formData, "new_password");
  const isActive = value(formData, "is_active") === "true";

  if (!employeeId || !fullName || !phone || !email || !telegramUsername || !city || storeIds.length === 0 || !["padawan", "experienced"].includes(employeeStatus)) {
    return NextResponse.redirect(adminUrl(request, "admin-required"), 303);
  }

  if (!isValidEmail(email)) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Введите email в формате name@example.com."), 303);
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(appRedirectUrl(request, "/login"), 303);
  }

  const { roles } = await getCurrentRoleCodes();
  if (!hasAnyRole(roles, MANAGE_ROLES)) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Недостаточно прав."), 303);
  }

  const currentRoleCode = roles.find((role): role is RoleCode =>
    ["developer", "super_admin", "store_manager", "warehouse_manager", "auditor", "warehouse_assistant", "manager"].includes(role),
  );

  if (!currentRoleCode) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Не удалось определить вашу должность."), 303);
  }

  const { data: targetProfile, error: profileError } = await supabase
    .from("profiles")
    .select("id, employee_id")
    .eq("employee_id", employeeId)
    .maybeSingle()
    .returns<ProfileRow>();

  if (profileError) {
    return NextResponse.redirect(adminUrl(request, "admin-error", profileError.message), 303);
  }

  let targetRoleCode: RoleCode | null = null;

  if (targetProfile?.id) {
    const { data: targetRoles, error: roleLookupError } = await supabase
      .from("user_roles")
      .select("roles(code)")
      .eq("profile_id", targetProfile.id)
      .is("revoked_at", null)
      .returns<UserRoleRow[]>();

    if (roleLookupError) {
      return NextResponse.redirect(adminUrl(request, "admin-error", roleLookupError.message), 303);
    }

    targetRoleCode = targetRoles.map((row) => row.roles?.code).find(Boolean) ?? null;
    if (targetRoleCode && !canManageTargetRole(currentRoleCode, targetRoleCode)) {
      return NextResponse.redirect(adminUrl(request, "admin-error", "Нельзя менять учётку с более высоким приоритетом."), 303);
    }
  }

  if (employeeRole && !canManageTargetRole(currentRoleCode, employeeRole)) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Нельзя назначить должность выше своей."), 303);
  }

  const canEditAuthAccount = roles.some((role) => ["super_admin", "developer"].includes(role));
  if (!canEditAuthAccount && newPassword) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Только супер-админ и разработчик могут менять пароль."), 303);
  }

  const [accessibleStores, currentScope] = await Promise.all([getAccessibleStores(), getCurrentEmployeeScope()]);
  const accessibleStoreIds = new Set(accessibleStores.map((store) => store.id));
  if (storeIds.some((storeId) => !accessibleStoreIds.has(storeId))) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Можно назначить только доступные вам магазины."), 303);
  }

  const currentCity = currentScope.city?.trim().toLowerCase() ?? "";
  if (!currentScope.isDeveloper && currentCity && city.trim().toLowerCase() !== currentCity) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Можно редактировать сотрудников только в своём городе."), 303);
  }

  const { data: targetEmployee, error: targetEmployeeError } = await supabase
    .from("employees")
    .select("city, is_active, employee_store_assignments(store_id)")
    .eq("id", employeeId)
    .maybeSingle()
    .returns<TargetEmployeeRow>();

  if (targetEmployeeError) {
    return NextResponse.redirect(adminUrl(request, "admin-error", targetEmployeeError.message), 303);
  }

  if (!targetEmployee) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Сотрудник не найден."), 303);
  }

  if (!targetEmployee.is_active && !currentScope.isDeveloper) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Удалённые учётки видит и восстанавливает только разработчик."), 303);
  }

  const targetRoleForDelete = targetProfile?.id ? targetRoleCode : null;
  if (targetEmployee.is_active && !isActive && (!targetRoleForDelete || !canDeleteTargetRole(currentRoleCode, targetRoleForDelete))) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Можно удалять только учётки ниже своей должности."), 303);
  }

  if (!currentScope.isDeveloper) {
    const targetCity = targetEmployee?.city?.trim().toLowerCase() ?? "";
    const targetHasAccessibleStore = targetEmployee?.employee_store_assignments.some((assignment) => accessibleStoreIds.has(assignment.store_id)) ?? false;
    if (!targetEmployee || (currentCity && targetCity !== currentCity) || !targetHasAccessibleStore) {
      return NextResponse.redirect(adminUrl(request, "admin-error", "Можно редактировать только сотрудников своего города и доступных магазинов."), 303);
    }
  }

  const { error } = await supabase.rpc("admin_update_employee_account", {
    p_employee_id: employeeId,
    p_full_name: fullName,
    p_phone: phone,
    p_email: email,
    p_telegram_username: telegramUsername,
    p_city: city,
    p_primary_store_id: primaryStoreId || null,
    p_employee_status: employeeStatus,
    p_is_active: isActive,
    p_new_password: canEditAuthAccount ? newPassword || null : null,
  });

  if (error) {
    return NextResponse.redirect(adminUrl(request, "admin-error", error.message), 303);
  }

  if (employeeRole) {
    const { error: roleError } = await supabase.rpc("admin_set_employee_role", {
      p_employee_id: employeeId,
      p_role_code: employeeRole,
    });

    if (roleError) {
      return NextResponse.redirect(adminUrl(request, "admin-error", roleError.message), 303);
    }
  }

  const { error: assignmentError } = await supabase.rpc("admin_replace_employee_store_assignments", {
    p_employee_id: employeeId,
    p_store_ids: storeIds,
  });

  if (assignmentError) {
    return NextResponse.redirect(adminUrl(request, "admin-error", assignmentError.message), 303);
  }

  return NextResponse.redirect(adminUrl(request, "employee-updated"), 303);
}
