import { NextResponse } from "next/server";
import { staffQaSupabase, staffQaWorkerAuthorized } from "@/lib/staff-telegram-qa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!staffQaWorkerAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await staffQaSupabase().from("staff_telegram_qa_owner_questions")
    .select("id,report_id,question,context,status,response_type,response_text,response_source,operator_followup,telegram_message_id,answered_at,next_attempt_at,staff_telegram_qa_reports(request_no,caption)")
    .in("status", ["pending", "answered"]).order("created_at", { ascending: true }).limit(50);
  if (error) return NextResponse.json({ error: "Could not load active owner questions" }, { status: 503 });
  return NextResponse.json({ questions: data ?? [] });
}
