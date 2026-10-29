import { NextRequest, NextResponse } from "next/server";
import { getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { getAccessibleStores, getCurrentEmployeeScope } from "@/lib/auth/stores";
import { loadAcademyPayLevels } from "@/lib/payroll/academy-level.server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function redirectBack(request: NextRequest, result: string) {
  const url = new URL("/finances", request.url);
  url.searchParams.set("form", "academy-packages");
  url.searchParams.set("message", result);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const employeeId = String(form.get("employee_id") ?? "").trim();
  const month = String(form.get("month") ?? "").trim();
  const amount = Number(form.get("amount"));
  const reason = String(form.get("reason") ?? "").trim();
  if (!employeeId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < "2026-11"
    || ![3000, 5000].includes(amount) || reason.length < 4 || reason.length > 1000) {
    return redirectBack(request, "package-error");
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url), 303);
  const { roles } = await getCurrentRoleCodes(supabase, user);
  if (!hasAnyRole(roles, [...MANAGE_ROLES, "developer"])) return redirectBack(request, "package-error");

  const [accessibleStores, scope, employeeResult] = await Promise.all([
    getAccessibleStores(supabase), getCurrentEmployeeScope(),
    supabase.from("employees").select("id, city, employee_store_assignments(store_id)").eq("id", employeeId).maybeSingle(),
  ]);
  const employee = employeeResult.data;
  if (employeeResult.error || !employee) return redirectBack(request, "package-error");
  if (!scope.isDeveloper) {
    const accessibleIds = new Set(accessibleStores.map((store) => store.id));
    const hasStoreAccess = employee.employee_store_assignments?.some((assignment: { store_id: string }) => accessibleIds.has(assignment.store_id));
    if (!hasStoreAccess || (scope.city && employee.city?.trim().toLocaleLowerCase("ru-RU") !== scope.city.trim().toLocaleLowerCase("ru-RU"))) {
      return redirectBack(request, "package-error");
    }
  }

  let level: number;
  try {
    const payLevel = await loadAcademyPayLevels(supabase, [employeeId], `${month}-01`);
    level = payLevel.get(employeeId)?.level ?? 0;
  } catch {
    return redirectBack(request, "package-error");
  }
  if (level < 7) return redirectBack(request, "package-ineligible");

  const { error } = await supabase.from("academy_payroll_packages").insert({
    employee_id: employeeId,
    period_month: `${month}-01`,
    package_type: "mentorship",
    amount,
    reason,
    assigned_by: user.id,
  });
  return redirectBack(request, error ? "package-error" : "package-saved");
}
