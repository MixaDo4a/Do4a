import { NextRequest, NextResponse } from "next/server";
import { getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function redirectUrl(request: NextRequest, message: string, detail?: string, storeId?: string) {
  const url = new URL("/admin/routine", request.url);
  url.searchParams.set("message", message);
  if (detail) {
    url.searchParams.set("detail", detail);
  }
  if (storeId) {
    url.searchParams.set("storeId", storeId);
  }
  return url;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const storeId = value(formData, "store_id");
  const templateId = value(formData, "template_id");
  const routineKind = value(formData, "routine_kind");
  const itemKeysRaw = value(formData, "item_keys");

  if (!storeId || !templateId || !["morning", "evening"].includes(routineKind) || !itemKeysRaw) {
    return NextResponse.redirect(redirectUrl(request, "routine-error", "Недостаточно данных для сохранения настроек.", storeId), 303);
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
    return NextResponse.redirect(redirectUrl(request, "routine-error", "Недостаточно прав для редактирования настроек.", storeId), 303);
  }

  const accessibleStores = await getAccessibleStores();
  if (!accessibleStores.some((store) => store.id === storeId)) {
    return NextResponse.redirect(redirectUrl(request, "routine-error", "Можно редактировать только доступные магазины.", storeId), 303);
  }

  const { data: templateRow, error: templateError } = await supabase
    .from("day_routine_templates")
    .select("id, store_id, routine_kind")
    .eq("id", templateId)
    .maybeSingle<{ id: string; store_id: string; routine_kind: string }>();

  if (templateError) {
    return NextResponse.redirect(redirectUrl(request, "routine-error", templateError.message, storeId), 303);
  }

  if (!templateRow || templateRow.store_id !== storeId || templateRow.routine_kind !== routineKind) {
    return NextResponse.redirect(redirectUrl(request, "routine-error", "Шаблон распорядка не найден.", storeId), 303);
  }

  const itemKeys = JSON.parse(itemKeysRaw) as string[];
  if (!Array.isArray(itemKeys) || itemKeys.length === 0) {
    return NextResponse.redirect(redirectUrl(request, "routine-error", "Список пунктов пуст.", storeId), 303);
  }

  const serviceSupabase = createSupabaseServiceRoleClient();
  const settings = itemKeys.map((itemKey) => ({
    item_key: itemKey,
    requires_photo: formData.get(`requires_photo_${itemKey}`) === "on",
  }));

  const { error: deleteError } = await serviceSupabase
    .from("day_routine_template_item_settings")
    .delete()
    .eq("template_id", templateId);

  if (deleteError) {
    return NextResponse.redirect(redirectUrl(request, "routine-error", deleteError.message, storeId), 303);
  }

  if (settings.length > 0) {
    const { error: insertError } = await serviceSupabase.from("day_routine_template_item_settings").insert(
      settings.map((setting) => ({
        template_id: templateId,
        item_key: setting.item_key,
        requires_photo: setting.requires_photo,
        created_by: user.id,
        updated_by: user.id,
      })),
    );

    if (insertError) {
      return NextResponse.redirect(redirectUrl(request, "routine-error", insertError.message, storeId), 303);
    }
  }

  return NextResponse.redirect(redirectUrl(request, "routine-saved", "Фото-настройки распорядка сохранены.", storeId), 303);
}

