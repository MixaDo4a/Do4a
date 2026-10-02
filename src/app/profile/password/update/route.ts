import { NextRequest, NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

function profileUrl(request: NextRequest, message: string) {
  const url = new URL("/profile", request.url);
  url.searchParams.set("message", message);
  return url;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const currentPassword = String(formData.get("current_password") ?? "");
  const newPassword = String(formData.get("new_password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  if (newPassword.length < 8 || newPassword.length > 128) {
    return NextResponse.redirect(profileUrl(request, "password-length"), 303);
  }
  if (newPassword !== confirmPassword) {
    return NextResponse.redirect(profileUrl(request, "password-mismatch"), 303);
  }

  const response = NextResponse.redirect(profileUrl(request, "password-error"), 303);
  const supabase = createSupabaseRouteClient(request, response);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !user.email || !currentPassword) {
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }

  const { error } = await supabase.auth.updateUser({
    password: newPassword,
    current_password: currentPassword,
  });
  if (!error) response.headers.set("Location", profileUrl(request, "password-changed").toString());
  return response;
}
