import { NextRequest, NextResponse } from "next/server";
import { DEDUCTION_ROLES, getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { getAccessibleStores, getCurrentEmployeeScope } from "@/lib/auth/stores";
import { appRedirectUrl } from "@/lib/http/redirect-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type TargetEmployeeRow = {
  city: string | null;
  employee_store_assignments: { store_id: string }[];
};

function adminUrl(request: NextRequest, message: string, detail?: string) {
  const url = appRedirectUrl(request, "/admin");
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
  const month = value(formData, "month");
  const adjustmentType = value(formData, "adjustment_type");
  const amountRaw = value(formData, "amount");
  const reason = value(formData, "reason");

  if (!employeeId || !/^\d{4}-\d{2}$/.test(month) || !adjustmentType || !amountRaw || !reason) {
    return NextResponse.redirect(adminUrl(request, "admin-required"), 303);
  }

  if (!["bonus", "fine", "inventory", "expiration", "product"].includes(adjustmentType)) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Некорректный тип операции."), 303);
  }

  const amount = Number(amountRaw.replace(",", "."));
  if (!Number.isFinite(amount) || amount < 0) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Некорректная сумма."), 303);
  }

  const periodMonth = `${month}-01`;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(appRedirectUrl(request, "/login"), 303);
  }

  const { roles } = await getCurrentRoleCodes();
  if (!hasAnyRole(roles, DEDUCTION_ROLES)) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Недостаточно прав."), 303);
  }

  const warehouseManagerOnly = roles.includes("warehouse_manager") && !hasAnyRole(roles, MANAGE_ROLES);
  if (warehouseManagerOnly && adjustmentType === "bonus") {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Кладовщик может вносить только вычеты."), 303);
  }

  const [accessibleStores, currentScope] = await Promise.all([getAccessibleStores(), getCurrentEmployeeScope()]);
  if (!currentScope.isDeveloper) {
    const accessibleStoreIds = new Set(accessibleStores.map((store) => store.id));
    const currentCity = currentScope.city?.trim().toLowerCase() ?? "";
    const { data: targetEmployee, error: targetEmployeeError } = await supabase
      .from("employees")
      .select("city, employee_store_assignments(store_id)")
      .eq("id", employeeId)
      .maybeSingle()
      .returns<TargetEmployeeRow>();

    if (targetEmployeeError) {
      return NextResponse.redirect(adminUrl(request, "admin-error", targetEmployeeError.message), 303);
    }

    const targetCity = targetEmployee?.city?.trim().toLowerCase() ?? "";
    const targetHasAccessibleStore = targetEmployee?.employee_store_assignments.some((assignment) => accessibleStoreIds.has(assignment.store_id)) ?? false;
    if (!targetEmployee || (currentCity && targetCity !== currentCity) || !targetHasAccessibleStore) {
      return NextResponse.redirect(adminUrl(request, "admin-error", "Можно начислять только сотрудникам своего города и доступных магазинов."), 303);
    }
  }

  const { error } = await supabase.from("payroll_adjustments").insert({
    employee_id: employeeId,
    period_month: periodMonth,
    adjustment_type: adjustmentType,
    amount,
    reason,
    created_by: user.id,
  });

  if (error) {
    return NextResponse.redirect(adminUrl(request, "admin-error", error.message), 303);
  }

  const { error: recalcError } = await supabase.rpc("calculate_payroll_period", {
    p_period_month: periodMonth,
  });

  if (recalcError) {
    return NextResponse.redirect(adminUrl(request, "admin-error", recalcError.message), 303);
  }

  return NextResponse.redirect(adminUrl(request, "payroll-adjustment-saved"), 303);
}
