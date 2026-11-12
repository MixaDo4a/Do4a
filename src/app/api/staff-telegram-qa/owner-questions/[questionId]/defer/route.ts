import { NextResponse } from "next/server";
import { staffQaSupabase, staffQaWorkerAuthorized } from "@/lib/staff-telegram-qa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ questionId: string }> }) {
  if (!staffQaWorkerAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { questionId } = await context.params;
  let body: { needs_clarification?: boolean; clarification?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!/^[0-9a-f-]{36}$/i.test(questionId) || typeof body.needs_clarification !== "boolean" ||
      (body.clarification !== undefined && (typeof body.clarification !== "string" || body.clarification.length > 2500))) {
    return NextResponse.json({ error: "Invalid defer request" }, { status: 400 });
  }
  const { data, error } = await staffQaSupabase().rpc("staff_defer_telegram_qa_owner_answer", {
    p_question_id: questionId,
    p_needs_clarification: body.needs_clarification,
    p_clarification: body.clarification ?? "",
  });
  const retryAfterSeconds = typeof data === "number" ? data : null;
  if (error || retryAfterSeconds === null) return NextResponse.json({ error: "Could not update owner answer processing state" }, { status: 409 });
  return NextResponse.json({ ok: true, retry_after_seconds: retryAfterSeconds });
}
