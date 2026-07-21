import { NextRequest, NextResponse } from "next/server";
import { canDeleteTargetRole, getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES, ROLE_HIERARCHY, RoleRelation, roleCodeFromRelation } from "@/lib/auth/roles";
import { appRedirectUrl } from "@/lib/http/redirect-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RoleLookupRow = {
  user_roles: { revoked_at: string | null; roles: RoleRelation }[];
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

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const employeeId = value(formData, "employee_id");

  if (!employeeId) {
    return NextResponse.redirect(adminUrl(request, "admin-required"), 303);
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

  const { data: employeeRow, error: employeeError } = await supabase
    .from("profiles")
    .select("id, user_roles!user_roles_profile_id_fkey(roles(code), revoked_at)")
    .eq("employee_id", employeeId)
    .maybeSingle<RoleLookupRow>();

  if (employeeError) {
    return NextResponse.redirect(adminUrl(request, "admin-error", employeeError.message), 303);
  }

  const currentRoleCode = [...ROLE_HIERARCHY].find((role) => roles.includes(role)) ?? null;
  const targetRoleCode = roleCodeFromRelation(employeeRow?.user_roles?.find((row) => !row.revoked_at)?.roles ?? null);

  if (!currentRoleCode || !targetRoleCode || !canDeleteTargetRole(currentRoleCode, targetRoleCode)) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Можно удалять только учётки ниже своей должности."), 303);
  }

  const { error } = await supabase.rpc("admin_delete_employee", {
    p_employee_id: employeeId,
  });

  if (error) {
    return NextResponse.redirect(adminUrl(request, "admin-error", error.message), 303);
  }

  return NextResponse.redirect(adminUrl(request, "employee-deleted"), 303);
}
