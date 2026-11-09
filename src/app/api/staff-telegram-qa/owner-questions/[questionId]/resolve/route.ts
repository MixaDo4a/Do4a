import { NextResponse } from "next/server";
import { staffQaSupabase, staffQaWorkerAuthorized } from "@/lib/staff-telegram-qa";
import { saveStaffQaReview } from "@/lib/staff-telegram-qa-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ questionId: string }> }) {
  if (!staffQaWorkerAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { questionId } = await context.params;
  let body: {
    summary?: string;
    review?: { category?: string; summary?: string; basis?: string; next_step?: string; ignore?: boolean };
  };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!/^[0-9a-f-]{36}$/i.test(questionId) || !body.summary?.trim() || body.summary.length > 4000) {
    return NextResponse.json({ error: "Invalid resolution" }, { status: 400 });
  }
  const supabase = staffQaSupabase();
  const { data: question, error: questionError } = await supabase.from("staff_telegram_qa_owner_questions")
    .select("id,report_id,status").eq("id", questionId).maybeSingle();
  if (questionError || !question) return NextResponse.json({ error: "Owner question not found" }, { status: 404 });
  if (question.status === "resolved") return NextResponse.json({ ok: true, already_resolved: true });
  if (question.status !== "answered") return NextResponse.json({ error: "Owner answer is not ready to resolve" }, { status: 409 });

  const { data: report, error: reportError } = await supabase.from("staff_telegram_qa_reports")
    .select("status").eq("id", question.report_id).maybeSingle();
  if (reportError || !report) return NextResponse.json({ error: "Related report not found" }, { status: 404 });
  if (report.status === "processing") {
    if (!body.review?.category || !body.review.summary?.trim()) return NextResponse.json({ error: "Final review is required" }, { status: 400 });
    try { await saveStaffQaReview(question.report_id, body.review as { category: string; summary: string; basis?: string; next_step?: string; ignore?: boolean }); }
    catch (error) {
      const status = error instanceof Error && error.message === "Report is not currently claimed" ? 409 : 503;
      return NextResponse.json({ error: "Could not save the final report review" }, { status });
    }
  } else if (report.status !== "reviewed" && report.status !== "ignored") {
    return NextResponse.json({ error: "Related report is not ready to resolve" }, { status: 409 });
  }

  const { data, error } = await supabase.rpc("staff_resolve_telegram_qa_owner_question", {
  const { data, error } = await supabase.rpc("staff_resolve_telegram_qa_owner_question", {
    p_question_id: questionId,
    p_summary: body.summary.trim(),
  });
  if (error || !data) return NextResponse.json({ error: "Owner answer is not awaiting resolution" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
