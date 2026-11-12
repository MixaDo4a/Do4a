import { NextResponse } from "next/server";
import { staffQaSupabase, staffQaWorkerAuthorized, telegramCall } from "@/lib/staff-telegram-qa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreatedQuestion = { question_id: string; request_no: number };

export async function POST(request: Request, context: { params: Promise<{ reportId: string }> }) {
  if (!staffQaWorkerAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { reportId } = await context.params;
  let body: { question?: string; context?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const question = body.question?.trim() ?? "";
  const contextText = body.context?.trim() ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(reportId) || question.length < 6 || question.length > 2500 || contextText.length > 1000) {
    return NextResponse.json({ error: "Invalid owner question" }, { status: 400 });
  }

  const approverId = Number(process.env.STAFF_QA_TELEGRAM_APPROVER_ID);
  if (!Number.isSafeInteger(approverId)) return NextResponse.json({ error: "Owner Telegram is not configured" }, { status: 503 });

  const supabase = staffQaSupabase();
  const { data: activeQuestion, error: activeQuestionError } = await supabase.from("staff_telegram_qa_owner_questions")
    .select("id,status,question")
    .eq("report_id", reportId).in("status", ["pending", "answered"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (activeQuestionError) return NextResponse.json({ error: "Could not check existing owner question" }, { status: 503 });
  if (activeQuestion) {
    return NextResponse.json({
      error: "This report already has an unresolved owner question. Continue that question instead of sending another card.",
      question_id: activeQuestion.id,
      status: activeQuestion.status,
    }, { status: 409 });
  }
  const { data: created, error: createError } = await supabase.rpc("staff_create_telegram_qa_owner_question", {
    p_report_id: reportId,
    p_question: question,
    p_context: contextText,
  });
  const row = (created as CreatedQuestion[] | null)?.[0];
  if (createError || !row) return NextResponse.json({ error: "Report is not available for an owner question" }, { status: 409 });

  try {
    const lines = [
      "STAFF · НУЖНО ВАШЕ РЕШЕНИЕ",
      `Заявка №${row.request_no}`,
      `Вопрос: ${question}`,
      contextText ? `Контекст: ${contextText}` : "",
      "Нажмите вариант или ответьте текстом на это сообщение. Ответ привяжется к этой заявке.",
    ].filter(Boolean);
    const sent = await telegramCall<{ message_id: number }>("sendMessage", {
      chat_id: approverId,
      text: lines.join("\n\n"),
      reply_markup: {
        inline_keyboard: [[
          { text: "Да, делаем", callback_data: `staffqa:owner:yes:${row.question_id}` },
          { text: "Нет, не делаем", callback_data: `staffqa:owner:no:${row.question_id}` },
        ]],
      },
    });
    const { error: messageError } = await supabase.from("staff_telegram_qa_owner_questions")
      .update({ telegram_message_id: sent.message_id, updated_at: new Date().toISOString() })
      .eq("id", row.question_id).eq("status", "pending");
    if (messageError) throw new Error("Could not persist owner question message");
    await supabase.from("staff_telegram_qa_owner_question_history").insert({
      question_id: row.question_id,
      event_type: "asked",
      details: { telegram_message_id: sent.message_id },
    });
    return NextResponse.json({ ok: true, question_id: row.question_id, request_no: row.request_no });
  } catch {
    try {
      await supabase.rpc("staff_fail_telegram_qa_owner_question", {
        p_question_id: row.question_id,
        p_error: "Could not deliver owner decision request in Telegram",
      });
    } catch { /* Preserve the delivery failure response. */ }
    return NextResponse.json({ error: "Could not send owner decision request" }, { status: 503 });
  }
}
