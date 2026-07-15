import { NextRequest, NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email) {
    return NextResponse.redirect(new URL("/login?message=email-required", request.url), 303);
  }

  if (!password) {
    return NextResponse.redirect(new URL("/login?message=password-required", request.url), 303);
  }

  const response = NextResponse.redirect(new URL("/", request.url), 303);
  const supabase = createSupabaseRouteClient(request, response);
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return NextResponse.redirect(new URL("/login?message=password-login-error", request.url), 303);
  }

  return response;
}
