import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ hasActiveSubscription: false }, { status: 401 });
  }

  const endpoint = request.nextUrl.searchParams.get("endpoint")?.trim();

  const query = supabase
    .from("push_subscriptions")
    .select("id")
    .eq("profile_id", user.id)
    .eq("is_active", true)
    .limit(1);

  if (endpoint) {
    query.eq("endpoint", endpoint);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ hasActiveSubscription: (data?.length ?? 0) > 0 });
}
