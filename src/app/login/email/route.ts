import { NextRequest, NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim();

  if (!email) {
    return NextResponse.redirect(new URL("/login?message=email-required", request.url), 303);
  }

  const response = NextResponse.redirect(new URL("/login?message=check-email", request.url), 303);
  const supabase = createSupabaseRouteClient(request, response);
  const redirectUrl = new URL("/auth/callback", request.url);
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: process.env.NEXT_PUBLIC_APP_URL ? `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback` : redirectUrl.toString(),
    },
  });

  if (error) {
    return NextResponse.redirect(new URL("/login?message=login-error", request.url), 303);
  }

  return response;
}
