import { NextRequest, NextResponse } from "next/server";
import { getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES, ROLE_HIERARCHY, roleRank } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function adminUrl(request: NextRequest, message: string, detail?: string) {
  const url = new URL("/admin", request.url);
  url.searchParams.set("message", message);
  if (detail) url.searchParams.set("detail", detail);
  return url;
}

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function values(formData: FormData, key: string) {
  return formData.getAll(key).map((item) => String(item).trim()).filter(Boolean);
}

type RoleLookupRow = {
  id: string;
};

type ActiveRoleRow = {
  roles: { code: string } | null;
  revoked_at: string | null;
};

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const employeeId = value(formData, "employee_id");
  const fullName = value(formData, "full_name");
  const phone = value(formData, "phone");
  const email = value(formData, "email");
  const telegramUsername = value(formData, "telegram_username").replace(/^@/, "");
  const city = value(formData, "city");
  const employeeStatus = value(formData, "employee_status");
  const storeIds = values(formData, "store_ids");
  const primaryStoreId = storeIds[0] ?? "";
  const employeeRole = value(formData, "employee_role") as "manager" | "auditor" | "store_manager" | "super_admin" | "developer" | "";
  const currentEmployeeRole = value(formData, "current_employee_role") as
    | "manager"
    | "auditor"
    | "store_manager"
    | "super_admin"
    | "developer"
    | "";
  const newPassword = value(formData, "new_password");
  const isActive = value(formData, "is_active") === "true";

  if (!employeeId || !fullName || !phone || !email || !telegramUsername || !city || storeIds.length === 0 || !["padawan", "experienced"].includes(employeeStatus)) {
    return NextResponse.redirect(adminUrl(request, "admin-required"), 303);
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }

  const { roles } = await getCurrentRoleCodes();
  if (!hasAnyRole(roles, MANAGE_ROLES)) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Недостаточно прав."), 303);
  }

  const canEditAuthAccount = roles.some((role) => ["super_admin", "developer"].includes(role));
  const currentRoleCode = [...ROLE_HIERARCHY].find((role) => roles.includes(role)) ?? null;

  const targetRoleCode = currentEmployeeRole || null;

  if (currentRoleCode && targetRoleCode && roleRank(targetRoleCode) < roleRank(currentRoleCode)) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Нельзя менять учётку с более высоким приоритетом."), 303);
  }

  if (!canEditAuthAccount && newPassword) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Только супер-админ и разработчик могут менять пароль."), 303);
  }

  const accessibleStores = await getAccessibleStores();
  const accessibleStoreIds = new Set(accessibleStores.map((store) => store.id));
  if (storeIds.some((storeId) => !accessibleStoreIds.has(storeId))) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Можно назначить только доступные вам магазины."), 303);
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
