import { NextRequest, NextResponse } from "next/server";
import { getCurrentRoleCodes, hasAnyRole } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function returnTo(request: NextRequest, result: "saved" | "error") {
  const url = new URL("/finances", request.url);
  url.searchParams.set("form", "payroll-mode");
  url.searchParams.set("message", result);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const city = String(form.get("city") ?? "").trim();
  const month = String(form.get("effective_month") ?? "").trim();
  const mode = String(form.get("calculation_mode") ?? "").trim();
  const reason = String(form.get("reason") ?? "").trim();

  if (!city || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !["legacy", "academy"].includes(mode) || reason.length < 4 || reason.length > 1000) {
    return returnTo(request, "error");
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url), 303);

  const { roles } = await getCurrentRoleCodes(supabase, user);
  if (!hasAnyRole(roles, ["super_admin"])) return returnTo(request, "error");

  const stores = await getAccessibleStores(supabase);
  if (!stores.some((store) => store.city === city)) return returnTo(request, "error");

  const { error } = await supabase.from("city_payroll_modes").insert({
    city,
    effective_from: `${month}-01`,
    calculation_mode: mode,
    reason,
    created_by: user.id,
  });
  if (error) return returnTo(request, "error");
  return returnTo(request, "saved");
}
