import { NextRequest, NextResponse } from "next/server";
import { getCurrentRoleCodes, hasAnyRole } from "@/lib/auth/roles";
import { getCurrentEmployeeScope } from "@/lib/auth/stores";
import { appRedirectUrl } from "@/lib/http/redirect-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const STORE_CREATE_ROLES = ["super_admin", "developer"];

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

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const city = value(formData, "city");
  const name = value(formData, "name");
  const address = value(formData, "address");
  const startTime = value(formData, "start_time") || "10:00";
  const endTime = value(formData, "end_time") || "21:00";

  if (!city || !name) {
    return NextResponse.redirect(adminUrl(request, "admin-required"), 303);
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(appRedirectUrl(request, "/login"), 303);
  }

  const [{ roles }, currentScope] = await Promise.all([getCurrentRoleCodes(), getCurrentEmployeeScope()]);

  if (!hasAnyRole(roles, STORE_CREATE_ROLES)) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Недостаточно прав."), 303);
  }

  const currentCity = currentScope.city?.trim().toLowerCase() ?? "";
  if (!currentScope.isDeveloper && currentCity && city.trim().toLowerCase() !== currentCity) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Можно создавать магазины только в своём городе."), 303);
  }

  const { data: storeRow, error: storeError } = await supabase
    .from("stores")
    .insert({
      city,
      name,
      address: address || null,
      workday_start_time: startTime,
      workday_end_time: endTime,
      created_by: user.id,
      updated_by: user.id,
    })
    .select("id")
    .single();

  if (storeError || !storeRow) {
    return NextResponse.redirect(adminUrl(request, "admin-error", storeError?.message), 303);
  }

  return NextResponse.redirect(adminUrl(request, "store-created"), 303);
}
