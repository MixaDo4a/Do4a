import { NextRequest, NextResponse } from "next/server";
import { getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const id = Number(form.get("package_id"));
  const url = new URL("/finances", request.url);
  url.searchParams.set("form", "academy-packages");
  if (!Number.isSafeInteger(id) || id <= 0) {
    url.searchParams.set("message", "package-error");
    return NextResponse.redirect(url, 303);
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url), 303);
  const { roles } = await getCurrentRoleCodes(supabase, user);
  if (!hasAnyRole(roles, [...MANAGE_ROLES, "developer"])) {
    url.searchParams.set("message", "package-error");
    return NextResponse.redirect(url, 303);
  }
  const { error } = await supabase.rpc("confirm_academy_payroll_package", { p_package_id: id });
  url.searchParams.set("message", error ? "package-error" : "package-confirmed");
  return NextResponse.redirect(url, 303);
}
