import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }

  await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("recipient_profile_id", user.id)
    .eq("is_read", false);

  return NextResponse.redirect(new URL("/notifications", request.url), 303);
}
