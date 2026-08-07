import { NextRequest, NextResponse } from "next/server";
import { getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { ensureStorageBucket } from "@/lib/storage/ensure-storage-bucket";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { uploadFormFile } from "@/lib/storage/upload-form-file";

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
  await ensureStorageBucket(serviceSupabase, "routine-photos", {
    public: false,
    fileSizeLimit: 25 * 1024 * 1024,
    allowedMimeTypes: ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/heic", "image/heif"],
  });
  const settings: {
    item_key: string;
    requires_photo: boolean;
    ai_review_enabled: boolean;
    reference_photo_file_id: string | null;
  }[] = [];

  try {
    for (const itemKey of itemKeys) {
      const requiresPhoto = formData.get(`requires_photo_${itemKey}`) === "on";
      const aiReviewEnabled = requiresPhoto && formData.get(`ai_review_enabled_${itemKey}`) === "on";
      const referenceFile = formData.get(`reference_photo_${itemKey}`);
      let referencePhotoFileId: string | null = null;

      if (referenceFile instanceof File && referenceFile.size > 0) {
        referencePhotoFileId = await uploadFormFile(
          serviceSupabase,
          "routine-photos",
          `templates/${templateId}/${itemKey}`,
          referenceFile,
          user.id,
          "day_routine_template_item_reference_photo",
          null,
        );
      }

      settings.push({
        item_key: itemKey,
        requires_photo: requiresPhoto,
        ai_review_enabled: aiReviewEnabled,
        reference_photo_file_id: referencePhotoFileId,
      });
    }
  } catch (error) {
    return NextResponse.redirect(
      redirectUrl(request, "routine-error", error instanceof Error ? error.message : "Не удалось сохранить фото-настройки.", storeId),
      303,
    );
  }

  const { error } = await supabase.rpc("save_day_routine_item_settings", {
    p_template_id: templateId,
    p_settings: settings,
  });

  if (error) {
    return NextResponse.redirect(redirectUrl(request, "routine-error", error.message, storeId), 303);
  }

  return NextResponse.redirect(redirectUrl(request, "routine-saved", "Фото-настройки распорядка сохранены.", storeId), 303);
}
