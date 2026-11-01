import { NextResponse } from "next/server";
import { staffQaSupabase, staffQaWorkerAuthorized, telegramCall } from "@/lib/staff-telegram-qa";

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
  const supabase = staffQaSupabase();
  const { data: report, error: reportError } = await supabase.from("staff_telegram_qa_reports")
    .select("id,request_no,telegram_chat_id,telegram_thread_id,telegram_message_id,telegram_user_id,status")
    .eq("id", reportId).maybeSingle();
  if (reportError) return NextResponse.json({ error: "Could not load report" }, { status: 503 });
  if (!report || report.status !== "processing") return NextResponse.json({ error: "Report is not currently claimed" }, { status: 409 });

  const { data, error } = await supabase.rpc("staff_record_telegram_qa_review", {
    p_report_id: reportId,
    p_category: body.category,
    p_summary: body.summary,
    p_basis: body.basis ?? "",
    p_next_step: body.next_step ?? "",
    p_ignore: Boolean(body.ignore),
  });
  if (error) return NextResponse.json({ error: "Could not save review" }, { status: 503 });
  if (!data) return NextResponse.json({ error: "Report is not currently claimed" }, { status: 409 });

  const rejected = Boolean(body.ignore);
  const message = [
    `STAFF QA · заявка №${report.request_no}`,
    rejected ? "Результат: заявка отклонена." : "Результат проверки: разбор завершён.",
    `Причина: ${body.summary.trim()}`,
    body.next_step?.trim() ? `Дальше: ${body.next_step.trim()}` : "",
  ].filter(Boolean).join("\n\n").slice(0, 3900);

  let groupNotified = false;
  let ownerNotified: boolean | null = rejected ? false : null;
  try {
    await telegramCall("sendMessage", {
      chat_id: report.telegram_chat_id,
      message_thread_id: report.telegram_thread_id,
      reply_to_message_id: report.telegram_message_id,
      text: message,
    });
    groupNotified = true;
  } catch { /* A notification failure must not roll back the saved review. */ }

  if (rejected) {
    const approverId = Number(process.env.STAFF_QA_TELEGRAM_APPROVER_ID);
    if (Number.isSafeInteger(approverId)) {
      try {
        await telegramCall("sendMessage", { chat_id: approverId, text: message });
        ownerNotified = true;
      } catch { /* The group result remains available if the owner's DM is unavailable. */ }
    }
  }

  const { data: reviewEvent } = await supabase.from("staff_telegram_qa_report_history")
    .select("id,details").eq("report_id", reportId).eq("event_type", "review_saved")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (reviewEvent) {
    await supabase.from("staff_telegram_qa_report_history").update({
      details: { ...(reviewEvent.details ?? {}), group_notified: groupNotified, owner_notified: ownerNotified },
    }).eq("id", reviewEvent.id);
  }

  return NextResponse.json({ ok: true, group_notified: groupNotified, owner_notified: ownerNotified });
}
