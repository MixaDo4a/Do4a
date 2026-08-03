import { NextResponse } from "next/server";
import { dispatchPushNotificationsFromEvent } from "@/lib/push";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await dispatchPushNotificationsFromEvent(supabase, { sinceMinutes: 10080 });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "push-sync-failed" }, { status: 400 });
  }
}

