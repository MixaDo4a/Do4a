import { NextResponse } from "next/server";
import { staffQaWorkerAuthorized } from "@/lib/staff-telegram-qa";
import { saveStaffQaReview } from "@/lib/staff-telegram-qa-review";

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
  try {
    const result = await saveStaffQaReview(reportId, {
      category: body.category!,
      summary: body.summary!,
      basis: body.basis,
      next_step: body.next_step,
      ignore: body.ignore,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Review failed";
    const status = message === "Report is not currently claimed" ? 409 : 503;
    return NextResponse.json({ error: message }, { status });
  }
}
