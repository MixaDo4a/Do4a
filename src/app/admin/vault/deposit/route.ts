import { NextRequest, NextResponse } from "next/server";
import { getCurrentRoleCodes } from "@/lib/auth/roles";
import { appRedirectUrl } from "@/lib/http/redirect-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function adminUrl(request: NextRequest, message: string) {
  const url = appRedirectUrl(request, "/admin");
  url.searchParams.set("message", message);
  return url;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const amount = Number(String(formData.get("amount") ?? "").trim());
  const comment = String(formData.get("comment") ?? "").trim();
  if (!Number.isFinite(amount) || amount <= 0 || !comment) {
    return NextResponse.redirect(adminUrl(request, "vault-deposit-required"), 303);
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(appRedirectUrl(request, "/login"), 303);

  const { roles } = await getCurrentRoleCodes(supabase, user);
  if (!roles.some((role) => role === "store_manager" || role === "super_admin")) {
    return NextResponse.redirect(adminUrl(request, "vault-deposit-denied"), 303);
  }

  const { error } = await supabase.rpc("create_vault_cash_deposit", {
    p_amount: amount,
    p_comment: comment,
  });
  if (error) return NextResponse.redirect(adminUrl(request, "vault-deposit-error"), 303);

  return NextResponse.redirect(adminUrl(request, "vault-deposit-saved"), 303);
}
