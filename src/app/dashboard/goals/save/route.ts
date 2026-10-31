import { NextRequest, NextResponse } from "next/server";
import { getAccessibleStores } from "@/lib/auth/stores";
import { isRetailStoreForMotivation } from "@/lib/store-motivation";
import { getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function formValue(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function dashboardUrl(request: NextRequest, period: string, message: string, detail?: string) {
  const url = new URL("/dashboard", request.url);
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) url.searchParams.set("period", period);
  url.searchParams.set("message", message);
  if (detail) url.searchParams.set("detail", detail);
  return url;
}

function parseOptionalPositive(value: string, label: string) {
  if (!value) return { value: null, error: null };
  const parsed = Number(value.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) return { value: null, error: `Проверьте значение: ${label}.` };
  return { value: parsed, error: null };
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const storeId = formValue(formData, "store_id");
  const period = formValue(formData, "period");
  const salesRaw = formValue(formData, "sales_plan_amount");
  const averageRaw = formValue(formData, "average_check_target");
  const depthRaw = formValue(formData, "check_depth_target");
  if (!storeId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    return NextResponse.redirect(dashboardUrl(request, period, "dashboard-error", "Выберите магазин и корректный месяц."), 303);
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url), 303);
  const { roles } = await getCurrentRoleCodes(supabase, user);
  if (!hasAnyRole(roles, MANAGE_ROLES)) {
    return NextResponse.redirect(dashboardUrl(request, period, "dashboard-error", "Недостаточно прав для изменения целей."), 303);
  }
  const accessibleStores = await getAccessibleStores(supabase);
  if (!accessibleStores.some((store) => store.id === storeId && isRetailStoreForMotivation(store.name))) {
    return NextResponse.redirect(dashboardUrl(request, period, "dashboard-error", "Магазин недоступен для вашей роли."), 303);
  }

  const periodStart = `${period}-01`;
  const periodEnd = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const { data: existingPlan, error: existingError } = await supabase.from("store_sales_plans")
    .select("sales_plan_amount").eq("store_id", storeId).eq("period_start", periodStart).eq("period_end", periodEnd).maybeSingle<{ sales_plan_amount: number | string }>();
  if (existingError) return NextResponse.redirect(dashboardUrl(request, period, "dashboard-error", "Не удалось загрузить текущие цели."), 303);

  const salesPlan = salesRaw ? Number(salesRaw.replace(",", ".")) : Number(existingPlan?.sales_plan_amount ?? 0);
  const average = parseOptionalPositive(averageRaw, "средний чек");
  const depth = parseOptionalPositive(depthRaw, "длина чека");
  if (!Number.isFinite(salesPlan) || salesPlan < 0 || average.error || depth.error) {
    return NextResponse.redirect(dashboardUrl(request, period, "dashboard-error", average.error ?? depth.error ?? "План продаж должен быть неотрицательным числом."), 303);
  }

  const values = {
    sales_plan_amount: salesPlan,
    average_check_target: average.value,
    check_depth_target: depth.value,
    is_auto_generated: false,
    updated_by: user.id,
  };
  const { error } = existingPlan
    ? await supabase.from("store_sales_plans").update(values).eq("store_id", storeId).eq("period_start", periodStart).eq("period_end", periodEnd)
    : await supabase.from("store_sales_plans").insert({
        store_id: storeId, period_start: periodStart, period_end: periodEnd,
        ...values, created_by: user.id,
      });
  if (error) return NextResponse.redirect(dashboardUrl(request, period, "dashboard-error", error.message), 303);
  return NextResponse.redirect(dashboardUrl(request, period, "dashboard-goals-saved"), 303);
}
