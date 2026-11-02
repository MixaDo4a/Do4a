import { NextRequest, NextResponse } from "next/server";
import { DEDUCTION_ROLES, getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { appRedirectUrl } from "@/lib/http/redirect-url";
import { applyAcademyPayrollToCalculatedRows } from "@/lib/payroll/academy-payroll-apply.server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function redirect(request: NextRequest, message: string) {
  const url = appRedirectUrl(request, "/admin");
  url.searchParams.set("message", message);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const storeId = String(formData.get("store_id") ?? "").trim();
  const month = String(formData.get("month") ?? "").trim();
  const amount = Number(String(formData.get("amount") ?? "").trim());
  const reason = String(formData.get("reason") ?? "").trim();
  if (!storeId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < "2026-11" || !Number.isFinite(amount) || amount <= 0 || !reason || reason.length > 1000) {
    return redirect(request, "admin-required");
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(appRedirectUrl(request, "/login"), 303);

  const { roles } = await getCurrentRoleCodes(supabase, user);
  const warehouseManagerOnly = roles.includes("warehouse_manager") && !hasAnyRole(roles, MANAGE_ROLES);
  if (!hasAnyRole(roles, DEDUCTION_ROLES) || !warehouseManagerOnly) return redirect(request, "admin-error");

  const { data, error } = await supabase.rpc("create_store_expiration_writeoff", {
    p_store_id: storeId,
    p_period_month: `${month}-01`,
    p_amount: amount,
    p_reason: reason,
  });
  if (error) return redirect(request, "admin-error");

  const employeeIds = Array.isArray(data) ? data.filter((id): id is string => typeof id === "string") : [];
  if (employeeIds.length > 0) {
    try {
      await applyAcademyPayrollToCalculatedRows(supabase, `${month}-01`, employeeIds);
    } catch {
      return redirect(request, "expiration-writeoff-recalc-error");
    }
  }

  return redirect(request, "expiration-writeoff-saved");
}
