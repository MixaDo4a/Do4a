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

  const { error } = await supabase.from("supplier_promotions").insert(
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
  );

  if (error) {
    return NextResponse.redirect(procurementUrl(request, "save-error", error.message), 303);
  }

  return NextResponse.redirect(procurementUrl(request, "saved"), 303);
}
