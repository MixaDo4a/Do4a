import { NextRequest, NextResponse } from "next/server";
import { getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { getAccessibleStores, getCurrentEmployeeScope } from "@/lib/auth/stores";
import { appRedirectUrl } from "@/lib/http/redirect-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_TIME_ZONE, STORE_TIME_ZONES } from "@/lib/timezone";

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

function hasChecklistFields(formData: FormData) {
  return [...formData.keys()].some(
    (key) =>
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
  const timezone = value(formData, "timezone") || DEFAULT_TIME_ZONE;
  const status = value(formData, "status");
  const salesSharePercentRaw = value(formData, "sales_share_percent");
  const includeChecklist = hasChecklistFields(formData);
  const removeChecklistItemId = value(formData, "checklist_remove_item_id");
  const newChecklistTitle = value(formData, "new_checklist_title");
  const newPadawanRaw = value(formData, "new_checklist_padawan");
  const newExperiencedRaw = value(formData, "new_checklist_experienced");

  if (!storeId || !city || !name || !status || !STORE_TIME_ZONES.some((zone) => zone.value === timezone)) {
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

  if (formData.has("sales_share_percent") && !canEditAdvanced) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Недостаточно прав для изменения процента от продаж."), 303);
  }

  if (removeChecklistItemId) {
    const [{ data: template }, { data: item }, { data: existingSetting }] = await Promise.all([
      supabase.from("checklist_templates").select("id").eq("is_active", true).order("version", { ascending: false }).limit(1).maybeSingle<{ id: string }>(),
      supabase.from("checklist_items").select("id, template_id, store_id, checklist_item_weights(employee_status, weight_amount)").eq("id", removeChecklistItemId).maybeSingle<{ id: string; template_id: string; store_id: string | null; checklist_item_weights: { employee_status: string; weight_amount: number }[] }>(),
      supabase.from("store_checklist_item_settings").select("custom_title, weight_padawan, weight_experienced").eq("store_id", storeId).eq("item_id", removeChecklistItemId).maybeSingle<{ custom_title: string | null; weight_padawan: number; weight_experienced: number }>(),
    ]);
    if (!template || !item || item.template_id !== template.id || (item.store_id && item.store_id !== storeId)) {
      return NextResponse.redirect(adminUrl(request, "admin-error", "Пункт не принадлежит чек-листу этого магазина."), 303);
    }
    const { error } = await supabase.from("store_checklist_item_settings").upsert({
      store_id: storeId,
      item_id: item.id,
      is_enabled: false,
      custom_title: existingSetting?.custom_title ?? null,
      weight_padawan: existingSetting?.weight_padawan ?? item.checklist_item_weights.find((weight) => weight.employee_status === "padawan")?.weight_amount ?? 0,
      weight_experienced: existingSetting?.weight_experienced ?? item.checklist_item_weights.find((weight) => weight.employee_status === "experienced")?.weight_amount ?? 0,
      created_by: user.id,
      updated_by: user.id,
    }, { onConflict: "store_id,item_id" });
    return NextResponse.redirect(error ? adminUrl(request, "admin-error", error.message) : adminUrl(request, "checklist-item-removed"), 303);
  }

  if (newChecklistTitle || newPadawanRaw || newExperiencedRaw) {
    try {
      const padawan = moneyValue(newPadawanRaw);
      const experienced = moneyValue(newExperiencedRaw);
      if (!newChecklistTitle || newChecklistTitle.length > 200 || padawan === null || experienced === null
        || padawan < 0 || experienced < 0 || padawan > 999999999999.99 || experienced > 999999999999.99) {
        throw new Error("Invalid checklist item");
      }
    } catch {
      return NextResponse.redirect(adminUrl(request, "admin-error", "Укажите название и стоимость нового пункта для обеих должностей."), 303);
    }
  }

  const salesSharePercent = salesSharePercentRaw ? moneyValue(salesSharePercentRaw) : null;
  if (salesSharePercent !== null && (salesSharePercent < 0 || salesSharePercent > 100)) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Процент должен быть от 0 до 100."), 303);
  }

  if (includeChecklist) {
    try {
      for (const [key, raw] of formData.entries()) {
        if (!key.startsWith("checklist_padawan_") && !key.startsWith("checklist_experienced_")) continue;
        const amount = moneyValue(String(raw));
        if (amount !== null && amount < 0) throw new Error("Invalid checklist amount");
      }
    } catch {
      return NextResponse.redirect(adminUrl(request, "admin-error", "Стоимость пункта должна быть неотрицательным числом."), 303);
    }
  }

  const { error: storeError } = await supabase
    .from("stores")
    .update({
      city,
      name,
      address: address || null,
      workday_start_time: startTime,
      workday_end_time: endTime,
      timezone,
      status,
      archived_at: status === "archived" ? new Date().toISOString() : null,
      ...(salesSharePercent !== null ? { sales_share_percent: salesSharePercent } : {}),
      updated_by: user.id,
    })
    .eq("id", storeId);

  if (storeError) {
    return NextResponse.redirect(adminUrl(request, "admin-error", storeError.message), 303);
  }

  if (includeChecklist) {
    const [templateResult, settingsResult] = await Promise.all([
      supabase
        .from("checklist_templates")
        .select("id, checklist_items(id, store_id, checklist_item_weights(employee_status, weight_amount))")
        .eq("is_active", true)
        .order("version", { ascending: false })
        .limit(1)
        .returns<{ id: string; checklist_items: { id: string; store_id: string | null; checklist_item_weights: { employee_status: "padawan" | "experienced"; weight_amount: number }[] }[] }[]>(),
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
    const items = (template?.checklist_items ?? []).filter((item) => !item.store_id || item.store_id === storeId);
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

  if (newChecklistTitle) {
    const { data: template, error: templateError } = await supabase.from("checklist_templates")
      .select("id").eq("is_active", true).order("version", { ascending: false }).limit(1).maybeSingle<{ id: string }>();
    if (templateError || !template) {
      return NextResponse.redirect(adminUrl(request, "admin-error", "Активный шаблон чек-листа не найден."), 303);
    }
    const { error: addError } = await supabase.rpc("add_store_checklist_item", {
      p_store_id: storeId,
      p_template_id: template.id,
      p_title: newChecklistTitle,
      p_weight_padawan: moneyValue(newPadawanRaw),
      p_weight_experienced: moneyValue(newExperiencedRaw),
    });
    if (addError) return NextResponse.redirect(adminUrl(request, "admin-error", addError.message), 303);
    return NextResponse.redirect(adminUrl(request, "checklist-item-added"), 303);
  }

  return NextResponse.redirect(adminUrl(request, "store-updated"), 303);
}
