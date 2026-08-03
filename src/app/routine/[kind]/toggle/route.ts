import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { RoutineKind } from "@/lib/routine";

export async function POST(request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (kind !== "morning" && kind !== "evening") {
    return NextResponse.json({ error: "Invalid routine kind" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const shiftId = String(body?.shiftId ?? "").trim();
  const templateItemId = String(body?.templateItemId ?? "").trim();
  const completed = Boolean(body?.completed ?? true);

  if (!shiftId || !templateItemId) {
    return NextResponse.json({ error: "Missing routine payload" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("toggle_day_routine_item_completion", {
    p_shift_id: shiftId,
    p_routine_kind: kind as RoutineKind,
    p_template_item_id: templateItemId,
    p_completed: completed,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, result: data });
}

