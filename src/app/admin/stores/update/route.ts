import { NextRequest, NextResponse } from "next/server";
import { getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { getAccessibleStores, getCurrentEmployeeScope } from "@/lib/auth/stores";
import { appRedirectUrl } from "@/lib/http/redirect-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const ADVANCED_ROLES = ["super_admin", "developer"];

function adminUrl(request: NextRequest, message: string, detail?: string) {
  const url = appRedirectUrl(request, "/admin/stores");
  url.searchParams.set("message", message);

  if (detail) {
    url.searchParams.set("detail", detail);
  }

  return url;
}

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function moneyValue(raw: string) {
  if (!raw) return null;

  const value = Number(raw.replace(",", "."));
  if (!Number.isFinite(value)) {
    throw new Error("Invalid number");
  }

  return value;
}

function hasAdvancedFields(formData: FormData) {
  return [...formData.keys()].some(
    (key) =>
      key === "sales_share_percent" ||
      key.startsWith("checklist_title_") ||
      key.startsWith("checklist_enabled_") ||
      key.startsWith("checklist_padawan_") ||
      key.startsWith("checklist_experienced_"),
  );
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const storeId = value(formData, "store_id");
  const city = value(formData, "city");
  const name = value(formData, "name");
  const address = value(formData, "address");
  const startTime = value(formData, "start_time") || null;
  const endTime = value(formData, "end_time") || null;
  const status = value(formData, "status");
  const salesSharePercentRaw = value(formData, "sales_share_percent");
  const includeAdvanced = hasAdvancedFields(formData);

  if (!storeId || !city || !name || !status) {
    return NextResponse.redirect(adminUrl(request, "admin-required"), 303);
  }

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

  const [accessibleStores, currentScope] = await Promise.all([getAccessibleStores(), getCurrentEmployeeScope()]);
  const accessibleStore = accessibleStores.find((store) => store.id === storeId);
  if (!accessibleStore) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Можно изменять только доступные вам магазины."), 303);
  }

  const currentCity = currentScope.city?.trim().toLowerCase() ?? "";
  if (!currentScope.isDeveloper && currentCity && city.trim().toLowerCase() !== currentCity) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Нельзя переносить магазин в другой город."), 303);
  }

  const isDeveloper = roles.includes("developer");
  const canEditAdvanced = roles.some((role) => ADVANCED_ROLES.includes(role));

  if (status === "archived" && !isDeveloper) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Скрывать магазины может только разработчик."), 303);
  }

  if (includeAdvanced && !canEditAdvanced) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Недостаточно прав для изменения расширенных настроек магазина."), 303);
  }

  const salesSharePercent = salesSharePercentRaw ? moneyValue(salesSharePercentRaw) : null;
  if (salesSharePercent !== null && (salesSharePercent < 0 || salesSharePercent > 100)) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Процент должен быть от 0 до 100."), 303);
  }

  const { error: storeError } = await supabase
    .from("stores")
    .update({
      city,
      name,
      address: address || null,
      workday_start_time: startTime,
      workday_end_time: endTime,
      status,
      archived_at: status === "archived" ? new Date().toISOString() : null,
      ...(salesSharePercent !== null ? { sales_share_percent: salesSharePercent } : {}),
      updated_by: user.id,
    })
    .eq("id", storeId);

  if (storeError) {
    return NextResponse.redirect(adminUrl(request, "admin-error", storeError.message), 303);
  }

  if (includeAdvanced && canEditAdvanced) {
    const [templateResult, settingsResult] = await Promise.all([
      supabase
        .from("checklist_templates")
        .select("id, checklist_items(id, checklist_item_weights(employee_status, weight_amount))")
        .eq("is_active", true)
        .order("version", { ascending: false })
        .limit(1)
        .returns<{ id: string; checklist_items: { id: string; checklist_item_weights: { employee_status: "padawan" | "experienced"; weight_amount: number }[] }[] }[]>(),
      supabase
        .from("store_checklist_item_settings")
        .select("item_id, is_enabled, custom_title, weight_padawan, weight_experienced")
        .eq("store_id", storeId)
        .returns<{ item_id: string; is_enabled: boolean; custom_title: string | null; weight_padawan: number; weight_experienced: number }[]>(),
    ]);

    if (templateResult.error) {
      return NextResponse.redirect(adminUrl(request, "admin-error", templateResult.error.message), 303);
    }

    if (settingsResult.error) {
      return NextResponse.redirect(adminUrl(request, "admin-error", settingsResult.error.message), 303);
    }

    const template = templateResult.data[0];
    const items = template?.checklist_items ?? [];
    const existingByItem = new Map(settingsResult.data.map((row) => [row.item_id, row]));

    const rows = items.map((item) => {
      const existing = existingByItem.get(item.id);
      const padawanDefault = item.checklist_item_weights.find((weight) => weight.employee_status === "padawan")?.weight_amount ?? 0;
      const experiencedDefault = item.checklist_item_weights.find((weight) => weight.employee_status === "experienced")?.weight_amount ?? 0;

      const padawanRaw = value(formData, `checklist_padawan_${item.id}`);
      const experiencedRaw = value(formData, `checklist_experienced_${item.id}`);
      const titleRaw = value(formData, `checklist_title_${item.id}`);
      const enabled = formData.get(`checklist_enabled_${item.id}`) !== null;

      return {
        store_id: storeId,
        item_id: item.id,
        is_enabled: enabled,
        custom_title: titleRaw || null,
        weight_padawan: padawanRaw ? moneyValue(padawanRaw) ?? padawanDefault : existing?.weight_padawan ?? padawanDefault,
        weight_experienced: experiencedRaw ? moneyValue(experiencedRaw) ?? experiencedDefault : existing?.weight_experienced ?? experiencedDefault,
        created_by: user.id,
        updated_by: user.id,
      };
    });

    const { error: settingsWriteError } = await supabase.from("store_checklist_item_settings").upsert(rows, { onConflict: "store_id,item_id" });

    if (settingsWriteError) {
      return NextResponse.redirect(adminUrl(request, "admin-error", settingsWriteError.message), 303);
    }
  }

  return NextResponse.redirect(adminUrl(request, "store-updated"), 303);
}
