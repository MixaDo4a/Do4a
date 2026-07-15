import { NextRequest, NextResponse } from "next/server";
import { getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
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
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }

  const { roles } = await getCurrentRoleCodes();
  if (!hasAnyRole(roles, MANAGE_ROLES)) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Недостаточно прав."), 303);
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
    p_period_month: `${month}-01`,
  });

  if (recalcError) {
    return NextResponse.redirect(adminUrl(request, "admin-error", recalcError.message), 303);
  }

  return NextResponse.redirect(adminUrl(request, "payroll-adjustment-saved"), 303);
}
