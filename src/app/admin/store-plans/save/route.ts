import { NextRequest, NextResponse } from "next/server";
import { getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { appRedirectUrl } from "@/lib/http/redirect-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
  const storeId = value(formData, "store_id");
  const month = value(formData, "month");
  const amountRaw = value(formData, "sales_plan_amount");
  const averageCheckRaw = value(formData, "average_check_target");
  const checkDepthRaw = value(formData, "check_depth_target");

  if (!storeId || !/^\d{4}-\d{2}$/.test(month) || !amountRaw) {
    return NextResponse.redirect(adminUrl(request, "admin-required"), 303);
  }

  const salesPlanAmount = Number(amountRaw.replace(",", "."));
  const averageCheckTarget = averageCheckRaw ? Number(averageCheckRaw.replace(",", ".")) : null;
  const checkDepthTarget = checkDepthRaw ? Number(checkDepthRaw.replace(",", ".")) : null;
  if (!Number.isFinite(salesPlanAmount) || salesPlanAmount < 0
    || (averageCheckTarget !== null && (!Number.isFinite(averageCheckTarget) || averageCheckTarget <= 0))
    || (checkDepthTarget !== null && (!Number.isFinite(checkDepthTarget) || checkDepthTarget <= 0))) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Некорректная сумма плана."), 303);
  }

  const periodStart = `${month}-01`;
  const start = new Date(`${periodStart}T00:00:00Z`);
  const periodEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);

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

  const accessibleStores = await getAccessibleStores();
  if (!accessibleStores.some((store) => store.id === storeId)) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Можно сохранять план только по доступным магазинам."), 303);
  }

  const { data: existingPlan, error: existingError } = await supabase
    .from("store_sales_plans")
    .select("average_check_target, check_depth_target")
    .eq("store_id", storeId)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd)
    .maybeSingle();
  if (existingError) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Не удалось прочитать текущие цели магазина."), 303);
  }

  const { error } = await supabase.from("store_sales_plans").upsert(
    {
      store_id: storeId,
      period_start: periodStart,
      period_end: periodEnd,
      sales_plan_amount: salesPlanAmount,
      average_check_target: averageCheckTarget ?? existingPlan?.average_check_target ?? null,
      check_depth_target: checkDepthTarget ?? existingPlan?.check_depth_target ?? null,
      created_by: user.id,
      updated_by: user.id,
    },
    { onConflict: "store_id,period_start,period_end" },
  );

  if (error) {
    return NextResponse.redirect(adminUrl(request, "admin-error", error.message), 303);
  }

  return NextResponse.redirect(adminUrl(request, "store-plan-saved"), 303);
}
