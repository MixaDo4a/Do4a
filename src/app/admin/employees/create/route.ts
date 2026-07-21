import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { canManageTargetRole, getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES, ROLE_HIERARCHY } from "@/lib/auth/roles";
import { getAccessibleStores, getCurrentEmployeeScope } from "@/lib/auth/stores";
import { appRedirectUrl } from "@/lib/http/redirect-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RoleCode =
  | "manager"
  | "auditor"
  | "store_manager"
  | "warehouse_manager"
  | "warehouse_assistant"
  | "super_admin"
  | "developer";

function adminUrl(request: NextRequest, message: string, detail?: string) {
  const url = appRedirectUrl(request, "/admin/employees");
  url.searchParams.set("message", message);

  if (detail) {
    url.searchParams.set("detail", detail);
  }

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
  const fullName = value(formData, "full_name");
  const phone = value(formData, "phone");
  const email = value(formData, "email").toLowerCase();
  const telegramUsername = value(formData, "telegram_username").replace(/^@/, "");
  const city = value(formData, "city");
  const employeeStatus = value(formData, "employee_status") || "padawan";
  const employeeRole = value(formData, "employee_role") as RoleCode | "";
  const storeIds = values(formData, "store_ids");
  const primaryStoreId = storeIds[0] ?? "";

  if (
    !fullName ||
    !phone ||
    !email ||
    !telegramUsername ||
    !city ||
    storeIds.length === 0 ||
    !["padawan", "experienced"].includes(employeeStatus) ||
    !employeeRole
  ) {
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

  const currentRoleCode = ROLE_HIERARCHY.find((code) => roles.includes(code)) ?? null;
  if (!currentRoleCode || !canManageTargetRole(currentRoleCode, employeeRole)) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Нельзя назначить должность выше своей или вне иерархии."), 303);
  }

  const [accessibleStores, currentScope] = await Promise.all([getAccessibleStores(), getCurrentEmployeeScope()]);
  const currentCity = currentScope.city?.trim().toLowerCase() ?? "";
  if (!currentScope.isDeveloper && currentCity && city.trim().toLowerCase() !== currentCity) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Можно создавать сотрудников только в своём городе."), 303);
  }

  const accessibleStoreIds = new Set(accessibleStores.map((store) => store.id));
  if (storeIds.some((storeId) => !accessibleStoreIds.has(storeId))) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Можно назначить только доступные вам магазины."), 303);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Не настроены переменные Supabase."), 303);
  }

  const authSupabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data: storeRow } = await supabase.from("stores").select("city").eq("id", primaryStoreId).maybeSingle();
  const initialPassword = "Do4aTest345";

  const { data: createdAuthUser, error: authError } = await authSupabase.auth.signUp({
    email,
    password: initialPassword,
    options: {
      data: {
        full_name: fullName,
        employee_role: employeeRole,
        telegram_username: telegramUsername,
      },
    },
  });

  if (authError || !createdAuthUser.user) {
    return NextResponse.redirect(adminUrl(request, "admin-error", authError?.message ?? "Не удалось создать учётку."), 303);
  }

  const { error: createError } = await supabase.rpc("admin_create_employee_account", {
    p_auth_user_id: createdAuthUser.user.id,
    p_full_name: fullName,
    p_phone: phone,
    p_email: email,
    p_telegram_username: telegramUsername,
    p_city: city || (storeRow?.city ?? ""),
    p_primary_store_id: primaryStoreId,
    p_employee_status: employeeStatus,
    p_role_code: employeeRole,
    p_store_ids: storeIds,
  });

  if (createError) {
    return NextResponse.redirect(adminUrl(request, "admin-error", createError.message), 303);
  }

  return NextResponse.redirect(adminUrl(request, "employee-created"), 303);
}
