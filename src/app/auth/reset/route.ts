import { NextRequest, NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const message = requestUrl.searchParams.get("message") ?? "session-expired";
  const response = NextResponse.redirect(new URL(`/login?message=${encodeURIComponent(message)}`, requestUrl.origin));
  const supabase = createSupabaseRouteClient(request, response);

  await supabase.auth.signOut();

  return response;
}
