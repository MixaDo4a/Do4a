import { NextResponse } from "next/server";
import { staffQaSupabase, staffQaWorkerAuthorized } from "@/lib/staff-telegram-qa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const categories = new Set(["bug", "content", "user_error", "question", "duplicate", "needs_info"]);

export async function POST(request: Request, context: { params: Promise<{ reportId: string }> }) {
  if (!staffQaWorkerAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { reportId } = await context.params;
  let body: { category?: string; summary?: string; basis?: string; next_step?: string; ignore?: boolean };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!categories.has(body.category ?? "") || !body.summary?.trim() || body.summary.length > 10000 ||
      (body.basis?.length ?? 0) > 10000 || (body.next_step?.length ?? 0) > 5000) {
    return NextResponse.json({ error: "Invalid review payload" }, { status: 400 });
  }
  const { data, error } = await staffQaSupabase().rpc("staff_record_telegram_qa_review", {
    p_report_id: reportId,
    p_category: body.category,
    p_summary: body.summary,
    p_basis: body.basis ?? "",
    p_next_step: body.next_step ?? "",
    p_ignore: Boolean(body.ignore),
  });
  if (error) return NextResponse.json({ error: "Could not save review" }, { status: 503 });
  if (!data) return NextResponse.json({ error: "Report is not currently claimed" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
