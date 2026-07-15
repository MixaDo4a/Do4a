import { NextRequest, NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login?message=logged-out", request.url), 303);
  const supabase = createSupabaseRouteClient(request, response);
  await supabase.auth.signOut();

  return response;
}
