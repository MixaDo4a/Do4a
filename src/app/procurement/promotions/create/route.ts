import { NextRequest, NextResponse } from "next/server";
import { getCurrentRoleCodes, hasAnyRole } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { appRedirectUrl } from "@/lib/http/redirect-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const CREATE_ROLES = ["buyer", "super_admin", "developer"];

type StoreRow = {
  id: string;
  name: string;
  city: string;
};

function procurementUrl(request: NextRequest, message: string, detail?: string) {
  const url = appRedirectUrl(request, "/procurement");
  url.searchParams.set("message", message);
  if (detail) url.searchParams.set("detail", detail);
  return url;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const storeIds = Array.from(
    new Set(
      formData
        .getAll("store_ids")
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  );
  const supplierName = String(formData.get("supplier_name") ?? "").trim();
  const productName = String(formData.get("product_name") ?? "").trim();
  const promotionTerms = String(formData.get("promotion_terms") ?? "").trim();
  const startsOn = String(formData.get("starts_on") ?? "").trim() || null;
  const endsOn = String(formData.get("ends_on") ?? "").trim() || null;

  if (storeIds.length === 0 || !supplierName || !productName || !promotionTerms) {
    return NextResponse.redirect(procurementUrl(request, "required"), 303);
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(appRedirectUrl(request, "/login"), 303);
  }

  const { roles } = await getCurrentRoleCodes();
  if (!hasAnyRole(roles, CREATE_ROLES)) {
    return NextResponse.redirect(procurementUrl(request, "save-error", "Недостаточно прав."), 303);
  }

  const accessibleStores = await getAccessibleStores();
  const accessibleStoreMap = new Map(accessibleStores.map((store) => [store.id, store]));
  const selectedStores = storeIds
    .map((storeId) => accessibleStoreMap.get(storeId))
    .filter(Boolean) as StoreRow[];

  if (selectedStores.length !== storeIds.length) {
    return NextResponse.redirect(procurementUrl(request, "save-error", "Магазин недоступен."), 303);
  }

  const { data: createdPromotions, error } = await supabase
    .from("supplier_promotions")
    .insert(
      selectedStores.map((store) => ({
        store_id: store.id,
        supplier_name: supplierName,
        product_name: productName,
        promotion_terms: promotionTerms,
        starts_on: startsOn,
        ends_on: endsOn,
        created_by: user.id,
        updated_by: user.id,
      })),
    )
    .select("id, store_id");

  if (error || !createdPromotions) {
    return NextResponse.redirect(procurementUrl(request, "save-error", error?.message ?? "Не удалось сохранить данные."), 303);
  }

  await Promise.all(
    createdPromotions.map(async (promotion) => {
      const store = selectedStores.find((item) => item.id === promotion.store_id);
      if (!store) {
        return;
      }

      await supabase.rpc("send_store_employees_notification", {
        p_store_id: store.id,
        p_event_type: "supplier_promotion_created",
        p_title: "Новая акция поставщика",
        p_body: `${store.name}: ${supplierName} — ${productName}`,
        p_related_entity_type: "supplier_promotion",
        p_related_entity_id: promotion.id,
      });
    }),
  );

  return NextResponse.redirect(procurementUrl(request, "saved"), 303);
}
