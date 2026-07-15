import { NextRequest, NextResponse } from "next/server";
import { getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function payrollUrl(request: NextRequest, message: string, periodMonth?: string, detail?: string) {
  const url = new URL("/payroll", request.url);
  url.searchParams.set("message", message);

  if (periodMonth) {
    url.searchParams.set("period", periodMonth);
  }

  if (detail) {
    url.searchParams.set("detail", detail);
  }

  return url;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const periodMonth = String(formData.get("period_month") ?? "").trim();

  if (!periodMonth) {
    return NextResponse.redirect(payrollUrl(request, "period-required"), 303);
  }

  if (!/^\d{4}-\d{2}$/.test(periodMonth)) {
    return NextResponse.redirect(payrollUrl(request, "calculate-error", undefined, "Некорректный месяц."), 303);
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
    return NextResponse.redirect(payrollUrl(request, "calculate-error", periodMonth, "Недостаточно прав."), 303);
  }

  const { error } = await supabase.rpc("calculate_payroll_period", {
    p_period_month: `${periodMonth}-01`,
  });

  if (error) {
    return NextResponse.redirect(payrollUrl(request, "calculate-error", periodMonth, error.message), 303);
  }

  return NextResponse.redirect(payrollUrl(request, "calculated", periodMonth), 303);
}

