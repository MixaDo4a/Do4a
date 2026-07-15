import { NextRequest, NextResponse } from "next/server";
import { canManageTargetRole, getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES, ROLE_HIERARCHY } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

function adminUrl(request: NextRequest, message: string, detail?: string) {
  const url = new URL("/admin/employees", request.url);
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
  return formData.getAll(key).map((item) => String(item).trim()).filter(Boolean);
}

type RoleCode = "manager" | "auditor" | "store_manager" | "super_admin" | "developer";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const fullName = value(formData, "full_name");
  const phone = value(formData, "phone");
  const email = value(formData, "email");
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

  const currentRoleCode = [...ROLE_HIERARCHY].find((code) => roles.includes(code)) ?? null;
  if (!currentRoleCode || !canManageTargetRole(currentRoleCode, employeeRole)) {
    return NextResponse.redirect(
      adminUrl(request, "admin-error", "Нельзя назначить должность выше своей или вне иерархии."),
      303,
    );
  }

  const accessibleStores = await getAccessibleStores();
  const accessibleStoreIds = new Set(accessibleStores.map((store) => store.id));
  if (storeIds.some((storeId) => !accessibleStoreIds.has(storeId))) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Можно назначить только доступные вам магазины."), 303);
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.redirect(
      adminUrl(request, "admin-error", "Не настроен SUPABASE_SERVICE_ROLE_KEY. Добавьте ключ в .env.local и перезапустите приложение."),
      303,
    );
  }

  const adminSupabase = createSupabaseServiceRoleClient();

  const { data: storeRow } = await supabase.from("stores").select("city").eq("id", primaryStoreId).maybeSingle();
  const initialPassword = "Do4aTest345";
  let createdEmployeeId: string | null = null;

  const { data: createdAuthUser, error: authError } = await adminSupabase.auth.admin.createUser({
    email,
    password: initialPassword,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      employee_role: employeeRole,
    },
  });

  if (authError || !createdAuthUser.user) {
    return NextResponse.redirect(adminUrl(request, "admin-error", authError?.message), 303);
  }

  try {
    const { data: employee, error: employeeError } = await adminSupabase
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
      throw new Error(employeeError?.message ?? "Failed to create employee");
    }
    createdEmployeeId = employee.id;

    const { error: profileError } = await adminSupabase.from("profiles").insert({
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

    const assignments = storeIds.map((storeId, index) => ({
      employee_id: employee.id,
      store_id: storeId,
      valid_from: new Date().toISOString().slice(0, 10),
      is_primary: index === 0,
      created_by: user.id,
      updated_by: user.id,
    }));

    const { error: assignmentError } = await adminSupabase.from("employee_store_assignments").insert(assignments);
    if (assignmentError) {
      throw new Error(assignmentError.message);
    }

    return NextResponse.redirect(adminUrl(request, "employee-created"), 303);
  } catch (error) {
    await adminSupabase.from("profiles").delete().eq("id", createdAuthUser.user.id);
    if (createdEmployeeId) {
      await adminSupabase.from("employees").delete().eq("id", createdEmployeeId);
    }
    await adminSupabase.auth.admin.deleteUser(createdAuthUser.user.id);

    return NextResponse.redirect(
      adminUrl(request, "admin-error", error instanceof Error ? error.message : "Не удалось сохранить данные."),
      303,
    );
  }
}
