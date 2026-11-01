"use server";

import { redirect } from "next/navigation";
import { staffQaSupabase } from "@/lib/staff-telegram-qa";
import { saveStaffQaReview } from "@/lib/staff-telegram-qa-review";

const reportId = "c895715f-9367-4689-9b4a-16568efc9936";

export async function rejectTestReportTwo() {
  if (process.env.VERCEL_ENV !== "preview") redirect("/staff-telegram-qa/setup?result=preview-only");

  const supabase = staffQaSupabase();
  const { data: report, error: loadError } = await supabase.from("staff_telegram_qa_reports")
    .select("id,request_no,status,caption,processing_attempts")
    .eq("id", reportId).maybeSingle();

  if (loadError || !report || report.request_no !== 2 || report.caption !== "пупупу") {
    redirect("/staff-telegram-qa/setup?result=review-target-mismatch");
  }
  if (report.status !== "new") redirect("/staff-telegram-qa/setup?result=review-already-handled");

  const { data: claimed, error: claimError } = await supabase.from("staff_telegram_qa_reports")
    .update({ status: "processing", locked_at: new Date().toISOString(), processing_attempts: (report.processing_attempts ?? 0) + 1, last_error: null })
    .eq("id", reportId).eq("status", "new").select("id").maybeSingle();
  if (claimError || !claimed) redirect("/staff-telegram-qa/setup?result=review-already-handled");

  await supabase.from("staff_telegram_qa_report_history").insert({
    report_id: reportId,
    event_type: "claimed",
    old_status: "new",
    new_status: "processing",
    actor_type: "reviewer",
    details: { source: "preview-review-console" },
  });

  let result: Awaited<ReturnType<typeof saveStaffQaReview>>;
  try {
    result = await saveStaffQaReview(reportId, {
      category: "question",
      summary: "Тестовая заявка без описания дефекта; она не подтверждает проблему в Do4a Staff.",
      basis: "В подписи только «пупупу», отсутствуют описание проблемы, ожидаемый и фактический результат.",
      next_step: "Для реального дефекта отправьте фото с кратким описанием действий и результата.",
      ignore: true,
    });
  } catch {
    await supabase.from("staff_telegram_qa_reports").update({ status: "new", locked_at: null })
      .eq("id", reportId).eq("status", "processing");
    redirect("/staff-telegram-qa/setup?result=review-failed");
  }
  redirect(`/staff-telegram-qa/setup?result=reviewed&group=${result.group_notified ? "1" : "0"}&owner=${result.owner_notified ? "1" : "0"}`);
}
