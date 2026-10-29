import { NextRequest, NextResponse } from "next/server";
import { getCurrentRoleCodes, hasAnyRole } from "@/lib/auth/roles";
import { appRedirectUrl } from "@/lib/http/redirect-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function ratesUrl(request: NextRequest, message: string, detail?: string) {
  const url = appRedirectUrl(request, "/finances/rates");
  url.searchParams.set("message", message);
  if (detail) url.searchParams.set("detail", detail);
  return url;
}

function amount(formData: FormData, field: string) {
  const raw = String(formData.get(field) ?? "").trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(appRedirectUrl(request, "/login"), 303);
  const { roles } = await getCurrentRoleCodes(supabase, user);
  if (!hasAnyRole(roles, ["super_admin", "developer"])) {
    return NextResponse.redirect(ratesUrl(request, "error", "Недостаточно прав."), 303);
  }

  const formData = await request.formData();
  const level = Number(formData.get("level"));
  const month = String(formData.get("month") ?? "").trim();
  const hourlyRate = amount(formData, "hourly_rate");
  const basePercent = amount(formData, "base_commission_percent");
  const planPercent = level < 5 ? basePercent : amount(formData, "plan_commission_percent");
  const reason = String(formData.get("reason") ?? "").trim();

  if (!Number.isInteger(level) || level < 1 || level > 10
    || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < "2026-11"
    || hourlyRate === null || hourlyRate <= 0
    || basePercent === null || basePercent > 100
    || planPercent === null || planPercent < basePercent || planPercent > 100
    || reason.length < 4 || reason.length > 500) {
    return NextResponse.redirect(ratesUrl(request, "error", "Проверьте месяц, суммы и причину изменения."), 303);
  }

  const { error } = await supabase.from("academy_pay_rates").insert({
    level,
    effective_from: `${month}-01`,
    hourly_rate: hourlyRate,
    base_commission_percent: basePercent,
    plan_commission_percent: planPercent,
    reason,
    created_by: user.id,
  });
  if (error) return NextResponse.redirect(ratesUrl(request, "error", "Не удалось сохранить ставку."), 303);
  return NextResponse.redirect(ratesUrl(request, "saved"), 303);
}
