import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dispatchPushNotificationsFromEvent } from "@/lib/push";

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("run_day_routine_evening_reminders");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  void dispatchPushNotificationsFromEvent(supabase, { sinceMinutes: 15 }).catch(() => null);

  return NextResponse.json({ ok: true, result: data });
}
