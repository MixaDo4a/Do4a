import { NextRequest, NextResponse } from "next/server";
import { getCurrentRoleCodes, hasAnyRole } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { appRedirectUrl } from "@/lib/http/redirect-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const CREATE_ROLES = ["buyer", "super_admin", "developer"];

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function procurementUrl(request: NextRequest, message: string, detail?: string) {
  const url = appRedirectUrl(request, "/procurement");
  url.searchParams.set("message", message);
  if (detail) url.searchParams.set("detail", detail);
  return url;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const storeId = value(formData, "store_id");
  const supplierName = value(formData, "supplier_name");
  const productName = value(formData, "product_name");
  const promotionTerms = value(formData, "promotion_terms");
  const startsOn = value(formData, "starts_on") || null;
  const endsOn = value(formData, "ends_on") || null;

  if (!storeId || !supplierName || !productName || !promotionTerms) {
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

  const accessibleStoreIds = new Set((await getAccessibleStores()).map((store) => store.id));
  if (!accessibleStoreIds.has(storeId)) {
    return NextResponse.redirect(procurementUrl(request, "save-error", "Магазин недоступен."), 303);
  }

  const { error } = await supabase.from("supplier_promotions").insert({
    store_id: storeId,
    supplier_name: supplierName,
    product_name: productName,
    promotion_terms: promotionTerms,
    starts_on: startsOn,
    ends_on: endsOn,
    created_by: user.id,
    updated_by: user.id,
  });

  if (error) {
    return NextResponse.redirect(procurementUrl(request, "save-error", error.message), 303);
  }

  return NextResponse.redirect(procurementUrl(request, "saved"), 303);
}
