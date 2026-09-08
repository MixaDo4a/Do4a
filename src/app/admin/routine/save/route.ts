import { NextRequest, NextResponse } from "next/server";
import { getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { parseRoutineOutline } from "@/lib/routine";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function adminUrl(request: NextRequest, message: string, detail?: string, storeId?: string) {
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

async function saveRoutineWithServiceRole(
  storeId: string,
  routineKind: string,
  title: string,
  items: Array<{ title: string; children: Array<{ title: string; children: any[] }> }>,
  userId: string,
) {
  const serviceSupabase = createSupabaseServiceRoleClient();
  const { data: template, error: templateError } = await serviceSupabase
    .from("day_routine_templates")
    .upsert(
      {
        store_id: storeId,
        routine_kind: routineKind,
        title: title || (routineKind === "morning" ? "Утренний распорядок" : "Вечерний распорядок"),
        is_active: true,
        created_by: userId,
        updated_by: userId,
      },
      { onConflict: "store_id,routine_kind" },
    )
    .select("id")
    .single<{ id: string }>();

  if (templateError || !template) {
    throw new Error(templateError?.message ?? "Не удалось сохранить шаблон распорядка.");
  }
  const templateId = template.id;

  const { error: deleteError } = await serviceSupabase.from("day_routine_template_items").delete().eq("template_id", templateId);
  if (deleteError) {
    throw new Error(deleteError.message);
  }

  async function insertItems(
    nodes: Array<{ title: string; children: Array<{ title: string; children: any[] }> }>,
    parentItemId: string | null,
    level: number,
    prefix: string,
  ) {
    for (const [index, node] of nodes.entries()) {
      const itemKey = prefix ? `${prefix}.${index + 1}` : `${index + 1}`;
      const { data: item, error: itemError } = await serviceSupabase
        .from("day_routine_template_items")
        .insert({
          template_id: templateId,
          parent_item_id: parentItemId,
          item_key: itemKey,
          title: node.title,
          level,
          sort_order: index + 1,
          is_active: true,
          created_by: userId,
          updated_by: userId,
        })
        .select("id")
        .single<{ id: string }>();

      if (itemError || !item) {
        throw new Error(itemError?.message ?? "Не удалось сохранить пункт распорядка.");
      }
      await insertItems(node.children, item.id, level + 1, itemKey);
    }
  }

  await insertItems(items, null, 0, "");
  return templateId;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const storeId = value(formData, "store_id");
  const routineKind = value(formData, "routine_kind");
  const title = value(formData, "title");
  const outline = value(formData, "outline");

  if (!storeId || !["morning", "evening"].includes(routineKind) || !outline) {
    return NextResponse.redirect(adminUrl(request, "routine-error", "Недостаточно данных для сохранения распорядка.", storeId), 303);
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
    return NextResponse.redirect(adminUrl(request, "routine-error", "Недостаточно прав для сохранения распорядка.", storeId), 303);
  }

  const accessibleStores = await getAccessibleStores();
  if (!accessibleStores.some((store) => store.id === storeId)) {
    return NextResponse.redirect(adminUrl(request, "routine-error", "Можно редактировать только доступные магазины.", storeId), 303);
  }

  let items: unknown;
  try {
    items = parseRoutineOutline(outline);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Не удалось разобрать распорядок.";
    return NextResponse.redirect(adminUrl(request, "routine-error", detail, storeId), 303);
  }

  const { error } = await supabase.rpc("save_day_routine_template", {
    p_store_id: storeId,
    p_routine_kind: routineKind,
    p_template_title: title || null,
    p_items: items,
  });

  if (error) {
    try {
      await saveRoutineWithServiceRole(storeId, routineKind, title, items as Array<{ title: string; children: Array<{ title: string; children: any[] }> }>, user.id);
    } catch (fallbackError) {
      const detail = fallbackError instanceof Error ? fallbackError.message : error.message;
      return NextResponse.redirect(adminUrl(request, "routine-error", detail, storeId), 303);
    }
  }

  return NextResponse.redirect(adminUrl(request, "routine-saved", undefined, storeId), 303);
}
