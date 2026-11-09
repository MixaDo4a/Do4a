import { NextResponse } from "next/server";
import { staffQaSupabase, staffQaWorkerAuthorized, telegramCall } from "@/lib/staff-telegram-qa";
import { saveStaffQaReview } from "@/lib/staff-telegram-qa-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ reportId: string }> }) {
  if (!staffQaWorkerAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { reportId } = await context.params;
  let body: { summary?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const summary = body.summary?.trim();
  if (!/^[0-9a-f-]{36}$/i.test(reportId) || !summary || summary.length > 4000) {
    return NextResponse.json({ error: "A valid report and completion summary are required" }, { status: 400 });
  }

  const supabase = staffQaSupabase();
  try {
    const { data: report, error: reportError } = await supabase.from("staff_telegram_qa_reports")
      .select("id,request_no,telegram_chat_id,telegram_thread_id,status,review_summary")
      .eq("id", reportId).maybeSingle();
    if (reportError || !report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

    if (report.status === "processing") {
      await saveStaffQaReview(reportId, {
        category: "bug",
        summary,
        basis: "Исправление проверено и развернуто в Do4a Staff Production.",
        next_step: "Изменение доступно в приложении.",
      });
    } else if (report.status !== "reviewed" || report.review_summary !== summary) {
      return NextResponse.json({ error: "Report is not awaiting this completion" }, { status: 409 });
    }

    const { data: event, error: eventError } = await supabase.from("staff_telegram_qa_report_history")
      .select("id,details").eq("report_id", reportId).eq("event_type", "review_saved")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (eventError || !event) throw new Error("Completion audit event is missing");
    let details = (event.details ?? {}) as Record<string, unknown>;
    const text = [`STAFF QA · заявка №${report.request_no}`, "Итог: выполнено.", `Результат: ${summary}`].join("\n\n");

    if (typeof details.completion_group_message_id !== "number") {
      const sent = await telegramCall<{ message_id: number }>("sendMessage", {
        chat_id: report.telegram_chat_id,
        message_thread_id: report.telegram_thread_id,
        text,
      });
      details = { ...details, completion_group_message_id: sent.message_id, completion_group_notified: true };
      const { error } = await supabase.from("staff_telegram_qa_report_history").update({ details }).eq("id", event.id);
      if (error) throw new Error("Group completion was sent but could not be recorded");
    }

    if (typeof details.completion_owner_message_id !== "number") {
      const approverId = Number(process.env.STAFF_QA_TELEGRAM_APPROVER_ID);
      if (!Number.isSafeInteger(approverId)) throw new Error("Staff QA approver is not configured");
      const sent = await telegramCall<{ message_id: number }>("sendMessage", { chat_id: approverId, text });
      details = { ...details, completion_owner_message_id: sent.message_id, completion_owner_notified: true };
      const { error } = await supabase.from("staff_telegram_qa_report_history").update({ details }).eq("id", event.id);
      if (error) throw new Error("Owner completion was sent but could not be recorded");
    }

    return NextResponse.json({ ok: true, status: "reviewed", group_notified: true, owner_notified: true });
  } catch {
    return NextResponse.json({ error: "Could not complete the Staff QA report" }, { status: 503 });
  }
}
