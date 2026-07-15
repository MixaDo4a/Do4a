import { NextRequest, NextResponse } from "next/server";
import { getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function adminUrl(request: NextRequest, message: string, detail?: string) {
  const url = new URL("/admin", request.url);
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
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }

  const { roles } = await getCurrentRoleCodes();

  if (!hasAnyRole(roles, MANAGE_ROLES)) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Недостаточно прав."), 303);
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

