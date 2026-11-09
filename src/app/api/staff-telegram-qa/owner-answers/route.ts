import { NextResponse } from "next/server";
import { staffQaSupabase, staffQaWorkerAuthorized } from "@/lib/staff-telegram-qa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!staffQaWorkerAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await staffQaSupabase().from("staff_telegram_qa_owner_questions")
    .select("id,report_id,question,context,response_type,response_text,answered_at,staff_telegram_qa_reports(id,request_no,caption)")
    .eq("status", "answered").order("answered_at", { ascending: true }).limit(50);
  if (error) return NextResponse.json({ error: "Could not load owner answers" }, { status: 503 });
  return NextResponse.json({ answers: data ?? [] });
}
