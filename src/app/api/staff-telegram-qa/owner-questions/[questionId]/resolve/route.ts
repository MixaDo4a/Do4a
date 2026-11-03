import { NextResponse } from "next/server";
import { staffQaSupabase, staffQaWorkerAuthorized } from "@/lib/staff-telegram-qa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ questionId: string }> }) {
  if (!staffQaWorkerAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { questionId } = await context.params;
  let body: { summary?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!/^[0-9a-f-]{36}$/i.test(questionId) || !body.summary?.trim() || body.summary.length > 4000) {
    return NextResponse.json({ error: "Invalid resolution" }, { status: 400 });
  }
  const { data, error } = await staffQaSupabase().rpc("staff_resolve_telegram_qa_owner_question", {
    p_question_id: questionId,
    p_summary: body.summary.trim(),
  });
  if (error || !data) return NextResponse.json({ error: "Owner answer is not awaiting resolution" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
