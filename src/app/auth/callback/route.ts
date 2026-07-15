import { NextRequest, NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const response = NextResponse.redirect(new URL("/", requestUrl.origin));

  if (code) {
    const supabase = createSupabaseRouteClient(request, response);
    await supabase.auth.exchangeCodeForSession(code);
  }

  return response;
}
