import { NextResponse } from "next/server";
import { staffQaSupabase, staffQaWorkerAuthorized } from "@/lib/staff-telegram-qa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ questionId: string }> }) {
  if (!staffQaWorkerAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { questionId } = await context.params;
  let body: { response_text?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const responseText = body.response_text?.trim() ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(questionId) || responseText.length < 1 || responseText.length > 4000) {
    return NextResponse.json({ error: "Invalid owner answer" }, { status: 400 });
  }

  const { data, error } = await staffQaSupabase().rpc("staff_answer_telegram_qa_owner_question", {
    p_question_id: questionId,
    p_response_type: "text",
    p_response_text: responseText,
    p_actor_telegram_user_id: null,
    p_response_source: "codex_chat",
  });
  const result = (data as { report_id: string; request_no: number }[] | null)?.[0];
  if (error || !result) return NextResponse.json({ error: "Question is no longer awaiting an answer" }, { status: 409 });
  return NextResponse.json({ ok: true, question_id: questionId, request_no: result.request_no, response_source: "codex_chat" });
}
