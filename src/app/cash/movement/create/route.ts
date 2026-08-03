import { NextRequest, NextResponse } from "next/server";
import { getCurrentRoleCodes, hasAnyRole } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { appRedirectUrl } from "@/lib/http/redirect-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const MANAGE_ROLES = ["super_admin", "developer"];

function cashUrl(request: NextRequest, message: string, detail?: string) {
  const url = appRedirectUrl(request, "/cash");
  url.searchParams.set("message", message);
  if (detail) url.searchParams.set("detail", detail);
  return url;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const storeId = String(formData.get("store_id") ?? "").trim();
  const movementType = String(formData.get("movement_type") ?? "").trim();
  const amount = Number(String(formData.get("amount") ?? "").trim());
  const comment = String(formData.get("comment") ?? "").trim();

  if (!storeId || !["rko", "pko"].includes(movementType) || !Number.isFinite(amount) || amount <= 0 || !comment) {
    return NextResponse.redirect(cashUrl(request, "required"), 303);
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
    return NextResponse.redirect(cashUrl(request, "save-error", "Недостаточно прав."), 303);
  }

  const accessibleStoreIds = new Set((await getAccessibleStores()).map((store) => store.id));
  if (!accessibleStoreIds.has(storeId)) {
    return NextResponse.redirect(cashUrl(request, "save-error", "Магазин недоступен."), 303);
  }

  const { error } = await supabase.from("store_cash_movements").insert({
    store_id: storeId,
    movement_type: movementType,
    amount,
    comment,
    created_by: user.id,
  });

  if (error) {
    return NextResponse.redirect(cashUrl(request, "save-error", error.message), 303);
  }

  return NextResponse.redirect(cashUrl(request, "saved"), 303);
}
