import { NextResponse } from "next/server";
import { staffQaSupabase, staffQaWorkerAuthorized } from "@/lib/staff-telegram-qa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ reportId: string }> }) {
  if (!staffQaWorkerAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { reportId } = await context.params;
  let body: { error?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (body.error && body.error.length > 1800) return NextResponse.json({ error: "Error description is too long" }, { status: 400 });

  const { data, error } = await staffQaSupabase().rpc("staff_release_telegram_qa_claim", {
    p_report_id: reportId,
    p_error: body.error ?? "Temporary review error; returned to queue",
  });
  if (error) return NextResponse.json({ error: "Could not release QA report" }, { status: 503 });
  if (!data) return NextResponse.json({ error: "Report is not currently claimed" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
