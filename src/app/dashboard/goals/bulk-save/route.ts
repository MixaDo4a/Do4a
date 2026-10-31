import { NextRequest, NextResponse } from "next/server";
import { getAccessibleStores } from "@/lib/auth/stores";
import { isRetailStoreForMotivation } from "@/lib/store-motivation";
import { getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function redirectToDashboard(request: NextRequest, period: string, message: string, detail?: string) {
  const url = new URL("/dashboard", request.url);
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) url.searchParams.set("goalsPeriod", period);
  for (const key of ["overviewPeriod", "employeesPeriod", "storesPeriod"]) {
    const value = request.nextUrl.searchParams.get(key);
    if (value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) url.searchParams.set(key, value);
  }
  url.searchParams.set("mainTab", "stores");
  url.searchParams.set("tab", "goals");
  url.searchParams.set("message", message);
  if (detail) url.searchParams.set("detail", detail);
  return NextResponse.redirect(url, 303);
}

function targetValue(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return { value: null, error: null };
  const parsed = Number(raw.replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0
    ? { value: parsed, error: null }
    : { value: null, error: "Цели должны быть положительными числами или пустыми." };
}

function salesPlanValue(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return { value: 0, error: null };
  const parsed = Number(raw.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0
    ? { value: parsed, error: null }
    : { value: null, error: "План оборота должен быть неотрицательным числом." };
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const period = String(form.get("period") ?? "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    return redirectToDashboard(request, period, "dashboard-error", "Выберите корректный месяц.");
  }
  const storeIds = [...new Set(form.getAll("store_ids").map(String).filter(Boolean))];
  if (!storeIds.length || storeIds.length > 100) {
    return redirectToDashboard(request, period, "dashboard-error", "Не выбраны магазины для сохранения.");
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url), 303);
  const { roles } = await getCurrentRoleCodes(supabase, user);
  if (!hasAnyRole(roles, MANAGE_ROLES)) {
    return redirectToDashboard(request, period, "dashboard-error", "Недостаточно прав для изменения целей.");
  }
  const accessibleStores = await getAccessibleStores(supabase);
  if (storeIds.some((id) => !accessibleStores.some((store) => store.id === id && isRetailStoreForMotivation(store.name)))) {
    return redirectToDashboard(request, period, "dashboard-error", "Один или несколько магазинов недоступны для вашей роли.");
  }

  const periodStart = `${period}-01`;
  const periodEnd = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const { data: existing, error: existingError } = await supabase.from("store_sales_plans")
    .select("store_id, sales_plan_amount")
    .in("store_id", storeIds).eq("period_start", periodStart).eq("period_end", periodEnd);
  if (existingError) return redirectToDashboard(request, period, "dashboard-error", "Не удалось прочитать текущие планы.");
  const currentSalesPlans = new Map((existing ?? []).map((row) => [row.store_id, row.sales_plan_amount]));

  const updates = [];
  for (const storeId of storeIds) {
    const salesPlan = salesPlanValue(form.get(`sales_plan_amount:${storeId}`));
    const average = targetValue(form.get(`average_check_target:${storeId}`));
    const depth = targetValue(form.get(`check_depth_target:${storeId}`));
    if (salesPlan.error || average.error || depth.error) {
      return redirectToDashboard(request, period, "dashboard-error", salesPlan.error ?? average.error ?? depth.error ?? "Проверьте цели.");
    }
    updates.push({
      store_id: storeId,
      period_start: periodStart,
      period_end: periodEnd,
      sales_plan_amount: salesPlan.value ?? Number(currentSalesPlans.get(storeId) ?? 0),
      average_check_target: average.value,
      check_depth_target: depth.value,
      is_auto_generated: false,
      updated_by: user.id,
    });
  }
  const { error } = await supabase.from("store_sales_plans").upsert(updates, { onConflict: "store_id,period_start,period_end" });
  if (error) return redirectToDashboard(request, period, "dashboard-error", "Не удалось сохранить планы KPI.");
  return redirectToDashboard(request, period, "dashboard-bulk-goals-saved");
}
