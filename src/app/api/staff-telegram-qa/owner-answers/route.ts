import { NextResponse } from "next/server";
import { staffQaSupabase, staffQaWorkerAuthorized } from "@/lib/staff-telegram-qa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!staffQaWorkerAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = staffQaSupabase();
  const now = new Date().toISOString();
  const activeReportStatuses = ["new", "processing", "awaiting_owner"];
  const { data, error } = await supabase.from("staff_telegram_qa_owner_questions")
    .select("id,report_id,question,context,response_type,response_text,response_source,operator_followup,answered_at,attempt_count,next_attempt_at,staff_telegram_qa_reports!inner(id,request_no,caption,status)")
    .eq("status", "answered")
    .in("staff_telegram_qa_reports.status", activeReportStatuses)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`)
    .order("answered_at", { ascending: true }).limit(50);
  if (error) return NextResponse.json({ error: "Could not load owner answers" }, { status: 503 });
  const { data: nextRetry, error: retryError } = await supabase.from("staff_telegram_qa_owner_questions")
    .select("next_attempt_at,staff_telegram_qa_reports!inner(status)")
    .eq("status", "answered")
    .in("staff_telegram_qa_reports.status", activeReportStatuses)
    .gt("next_attempt_at", now)
    .order("next_attempt_at", { ascending: true }).limit(1).maybeSingle();
  if (retryError) return NextResponse.json({ error: "Could not load the next owner-answer retry" }, { status: 503 });
  return NextResponse.json({ answers: data ?? [], next_retry_at: nextRetry?.next_attempt_at ?? null });
}
