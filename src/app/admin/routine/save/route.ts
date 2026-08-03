import { NextRequest, NextResponse } from "next/server";
import { getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { parseRoutineOutline } from "@/lib/routine";
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
    return NextResponse.redirect(adminUrl(request, "routine-error", error.message, storeId), 303);
  }

  return NextResponse.redirect(adminUrl(request, "routine-saved", undefined, storeId), 303);
}

