import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { canManageTargetRole, getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES, ROLE_HIERARCHY } from "@/lib/auth/roles";
import { getAccessibleStores, getCurrentEmployeeScope } from "@/lib/auth/stores";
import { appRedirectUrl } from "@/lib/http/redirect-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RoleCode = "manager" | "auditor" | "store_manager" | "warehouse_manager" | "warehouse_assistant" | "super_admin" | "developer";

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

  const currentRoleCode = [...ROLE_HIERARCHY].find((code) => roles.includes(code)) ?? null;
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
  let createdEmployeeId: string | null = null;

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

  try {
    const { data: employee, error: employeeError } = await supabase
      .from("employees")
      .insert({
        full_name: fullName,
        phone,
        email,
        telegram_username: telegramUsername,
        city: city || (storeRow?.city ?? null),
        primary_store_id: primaryStoreId || null,
        employee_status: employeeStatus,
        hired_at: new Date().toISOString().slice(0, 10),
        created_by: user.id,
        updated_by: user.id,
      })
      .select("id")
      .single();

    if (employeeError || !employee) {
      throw new Error(employeeError?.message ?? "Не удалось создать сотрудника.");
    }
    createdEmployeeId = employee.id;

    const { error: profileError } = await supabase.from("profiles").insert({
      id: createdAuthUser.user.id,
      employee_id: employee.id,
      telegram_username: telegramUsername,
      email,
      full_name: fullName,
    });

    if (profileError) {
      throw new Error(profileError.message);
    }

    const { error: roleError } = await supabase.rpc("admin_set_employee_role", {
      p_employee_id: employee.id,
      p_role_code: employeeRole,
    });

    if (roleError) {
      throw new Error(roleError.message);
    }

    const { error: assignmentError } = await supabase.rpc("admin_replace_employee_store_assignments", {
      p_employee_id: employee.id,
      p_store_ids: storeIds,
    });

    if (assignmentError) {
      throw new Error(assignmentError.message);
    }

    return NextResponse.redirect(adminUrl(request, "employee-created"), 303);
  } catch (error) {
    await supabase.from("profiles").delete().eq("id", createdAuthUser.user.id);
    if (createdEmployeeId) {
      await supabase.from("employees").delete().eq("id", createdEmployeeId);
    }

    return NextResponse.redirect(
      adminUrl(request, "admin-error", error instanceof Error ? error.message : "Не удалось сохранить данные."),
      303,
    );
  }
}
