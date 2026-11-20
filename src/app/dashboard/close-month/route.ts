import { NextRequest, NextResponse } from "next/server";
import { getCurrentRoleCodes, hasAnyRole } from "@/lib/auth/roles";
import { applyAcademyPayrollToCalculatedRows } from "@/lib/payroll/academy-payroll-apply.server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function dashboardUrl(request: NextRequest, message: string, detail?: string) {
  const url = new URL("/dashboard", request.url);
  url.searchParams.set("message", message);
  if (detail) url.searchParams.set("detail", detail);
  return url;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const periodMonth = String(formData.get("period_month") ?? "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(periodMonth)) {
    return NextResponse.redirect(dashboardUrl(request, "month-close-error", "Некорректный месяц."), 303);
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url), 303);

  const { roles } = await getCurrentRoleCodes(supabase, user);
  if (!hasAnyRole(roles, ["store_manager", "super_admin", "developer"])) {
    return NextResponse.redirect(dashboardUrl(request, "month-close-error", "Недостаточно прав."), 303);
  }

  const { data: period, error: periodError } = await supabase.from("payroll_periods")
    .select("status").eq("period_month", periodMonth).maybeSingle<{ status: string }>();
  if (periodError) return NextResponse.redirect(dashboardUrl(request, "month-close-error", "Не удалось проверить состояние месяца."), 303);
  if (period?.status === "closed") return NextResponse.redirect(dashboardUrl(request, "month-already-closed"), 303);

  const { error: calculateError } = await supabase.rpc("calculate_payroll_period", { p_period_month: periodMonth });
  if (calculateError) return NextResponse.redirect(dashboardUrl(request, "month-close-error", "Не удалось сформировать зарплату за месяц."), 303);

  try {
    await applyAcademyPayrollToCalculatedRows(supabase, periodMonth);
  } catch {
    return NextResponse.redirect(dashboardUrl(request, "month-close-error", "Не удалось применить расчёт зарплаты Академии."), 303);
  }

  const { error: closeError } = await supabase.rpc("close_payroll_period", { p_period_month: periodMonth });
  if (closeError) {
    const detail = closeError.message.includes("unfinished shifts")
      ? "Сначала завершите все смены этого месяца. Зарплатный расчёт сохранён, месяц не закрыт."
      : closeError.message.includes("previous calendar month")
        ? "Закрыть можно только предыдущий календарный месяц."
        : "Не удалось закрыть месяц.";
    return NextResponse.redirect(dashboardUrl(request, "month-close-error", detail), 303);
  }

  return NextResponse.redirect(dashboardUrl(request, "month-closed"), 303);
}
