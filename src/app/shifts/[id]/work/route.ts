import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

function workUrl(request: NextRequest, shiftId: string, status: string, detail?: string) {
  const url = new URL(`/shifts/${shiftId}`, request.url);
  url.searchParams.set("work", status);
  if (detail) url.searchParams.set("detail", detail.slice(0, 250));
  return url;
}

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url), 303);

  const formData = await request.formData();
  const action = value(formData, "action");
  if (action === "start" || action === "end") {
    const { error } = await supabase.rpc("mark_shift_work", {
      p_shift_id: id,
      p_action: action,
    });
    return NextResponse.redirect(workUrl(request, id, error ? "error" : "saved", error?.message), 303);
  }

  if (action === "correct") {
    const participantId = value(formData, "participant_id");
    const startedLocal = value(formData, "started_local");
    const endedLocal = value(formData, "ended_local");
    const reason = value(formData, "reason");
    if (!participantId || !startedLocal || !endedLocal || reason.length < 3) {
      return NextResponse.redirect(workUrl(request, id, "error", "Заполните отметки и причину исправления."), 303);
    }
    const { data: participant, error: participantError } = await supabase
      .from("shift_participants")
      .select("id")
      .eq("id", participantId)
      .eq("shift_id", id)
      .maybeSingle();
    if (participantError || !participant) {
      return NextResponse.redirect(workUrl(request, id, "error", "Участник смены не найден."), 303);
    }

    const { error } = await supabase.rpc("correct_shift_work", {
      p_participant_id: participantId,
      p_started_local: startedLocal,
      p_ended_local: endedLocal,
      p_reason: reason,
    });
    return NextResponse.redirect(workUrl(request, id, error ? "error" : "saved", error?.message), 303);
  }

  return NextResponse.redirect(workUrl(request, id, "error", "Неизвестное действие."), 303);
}
