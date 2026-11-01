import { NextResponse } from "next/server";
import { constantTimeSecretMatches, staffQaSupabase, STAFF_QA_BUCKET, telegramCall } from "@/lib/staff-telegram-qa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Update = {
  update_id?: number;
  message?: {
    message_id: number; message_thread_id?: number; date: number;
    chat: { id: number; type?: string };
    from?: { id: number; username?: string; first_name?: string; last_name?: string };
    text?: string;
    caption?: string;
    photo?: Array<{ file_id: string; file_unique_id: string; file_size?: number }>;
  };
  callback_query?: { id: string; from: { id: number }; data?: string; message?: { message_id: number; chat: { id: number; type?: string } } };
};

type VercelDeployment = {
  id?: string; uid?: string; url?: string; projectId?: string; readyState?: string;
  target?: string | null; aliasAssigned?: boolean; aliasError?: { message?: string } | null;
  gitSource?: { sha?: string } | null; meta?: Record<string, string>;
  errorCode?: string; errorMessage?: string;
};

function detectPhotoMime(bytes: Uint8Array) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP") return "image/webp";
  return null;
}

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function deploymentSha(deployment: VercelDeployment) {
  return (deployment.gitSource?.sha ?? deployment.meta?.githubCommitSha ?? deployment.meta?.gitCommitSha ?? "").toLowerCase();
}

async function vercelRequest(path: string, init?: RequestInit) {
  const url = new URL(path, "https://api.vercel.com");
  url.searchParams.set("teamId", env("STAFF_QA_VERCEL_TEAM_ID"));
  return fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${env("STAFF_QA_VERCEL_TOKEN")}`, ...(init?.headers ?? {}) },
    cache: "no-store",
  });
}

async function postReleaseStatus(approval: { report_id: string; commit_sha: string }, message: string) {
  await telegramCall("sendMessage", {
    chat_id: env("STAFF_QA_TELEGRAM_CHAT_ID"),
    message_thread_id: Number(env("STAFF_QA_TELEGRAM_THREAD_ID")),
    text: `STAFF QA · заявка ${approval.report_id.slice(0, 8)} · ${message}`,
  }).catch(() => undefined);
}

async function processApprovalCallback(callback: NonNullable<Update["callback_query"]>) {
  const approvalId = callback.data?.match(/^staffqa:(publish|reject):([0-9a-f-]{36})$/i);
  const approverId = Number(env("STAFF_QA_TELEGRAM_APPROVER_ID"));
  const message = callback.message;
  if (!approvalId || callback.from.id !== approverId || message?.chat.type !== "private" || message.chat.id !== approverId) {
    await telegramCall("answerCallbackQuery", { callback_query_id: callback.id, text: "Нет доступа к этому подтверждению.", show_alert: true }).catch(() => undefined);
    return;
  }
  const [, decision, id] = approvalId;
  const supabase = staffQaSupabase();
  const { data: row, error: lookupError } = await supabase.from("staff_telegram_qa_release_approvals")
    .select("id,report_id,preview_deployment_id,preview_url,commit_sha,summary,status")
    .eq("id", id).maybeSingle();
  if (lookupError || !row) {
    await telegramCall("answerCallbackQuery", { callback_query_id: callback.id, text: "Согласование не найдено.", show_alert: true }).catch(() => undefined);
    return;
  }
  const { data: claimed, error: decisionError } = await supabase.rpc("staff_decide_telegram_qa_release", {
    p_approval_id: id, p_decision: decision, p_actor_telegram_user_id: approverId,
  });
  if (decisionError || !claimed) {
    await telegramCall("answerCallbackQuery", { callback_query_id: callback.id, text: "Решение уже принято или заявка недоступна.", show_alert: true }).catch(() => undefined);
    return;
  }
  await telegramCall("answerCallbackQuery", { callback_query_id: callback.id, text: decision === "publish" ? "Проверяю и публикую…" : "Публикация отклонена." });
  await telegramCall("editMessageReplyMarkup", { chat_id: message!.chat.id, message_id: message!.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
  if (decision === "reject") {
    await postReleaseStatus(row, "владелец отклонил публикацию.");
    return;
  }

  let productionId: string | null = null;
  try {
    const projectId = env("STAFF_QA_VERCEL_PROJECT_ID");
    const candidateRes = await vercelRequest(`/v13/deployments/${encodeURIComponent(row.preview_deployment_id)}?withGitRepoInfo=true`);
    const candidate = await candidateRes.json() as VercelDeployment;
    if (!candidateRes.ok || candidate.projectId !== projectId || candidate.readyState !== "READY" || candidate.target === "production" ||
        candidate.url !== row.preview_url || deploymentSha(candidate) !== row.commit_sha.toLowerCase()) {
      throw new Error("Preview уже не совпадает с согласованным проектом, URL, статусом или SHA.");
    }
    const productionUrl = new URL(env("STAFF_QA_PRODUCTION_URL"));
    if (productionUrl.protocol !== "https:" || productionUrl.hostname.endsWith(".vercel.app") === false) {
      throw new Error("Production URL не прошёл проверку домена.");
    }
    const promote = await vercelRequest("/v13/deployments?forceNew=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "do4a", project: projectId, deploymentId: row.preview_deployment_id, target: "production", alias: [productionUrl.hostname] }),
    });
    const created = await promote.json() as VercelDeployment;
    productionId = created.id ?? created.uid ?? null;
    if (!promote.ok || !productionId || created.projectId !== projectId || created.target !== "production" || deploymentSha(created) !== row.commit_sha.toLowerCase()) {
      throw new Error("Vercel не подтвердил Production-сборку для согласованного коммита.");
    }
    const { error: stateError } = await supabase.rpc("staff_record_telegram_qa_release_state", {
      p_approval_id: id, p_status: "deploying", p_error: null,
      p_production_deployment_id: productionId, p_production_url: created.url ?? null,
    });
    if (stateError) throw new Error("Production запущен, но журнал статуса не обновился; требуется ручная сверка в Vercel.");
    const deadline = Date.now() + 50_000;
    while (Date.now() < deadline) {
      const statusResponse = await vercelRequest(`/v13/deployments/${encodeURIComponent(productionId)}?withGitRepoInfo=true`);
      const current = await statusResponse.json() as VercelDeployment;
      if (!statusResponse.ok || current.projectId !== projectId || current.target !== "production" || deploymentSha(current) !== row.commit_sha.toLowerCase()) {
        throw new Error("Идентификатор Production-деплоя не совпал с проверенным коммитом.");
      }
      if (current.readyState === "ERROR" || current.readyState === "CANCELED") {
        throw new Error(`Production-деплой ${current.readyState}: ${current.errorCode ?? ""} ${current.errorMessage ?? ""}`.trim().slice(0, 500));
      }
      if (current.readyState === "READY") {
        if (!current.aliasAssigned) throw new Error(`Деплой готов, но домен не привязан: ${current.aliasError?.message ?? ""}`.slice(0, 500));
        const { error: publishError } = await supabase.rpc("staff_record_telegram_qa_release_state", {
          p_approval_id: id, p_status: "published", p_error: null,
          p_production_deployment_id: productionId, p_production_url: current.url ? `https://${current.url}` : env("STAFF_QA_PRODUCTION_URL"),
        });
        if (publishError) throw new Error("Деплой готов, но итог не записался в журнал; требуется ручная сверка.");
        try {
          await telegramCall("setWebhook", {
            url: new URL("/api/staff-telegram-qa/webhook", productionUrl).toString(),
            secret_token: env("STAFF_QA_WEBHOOK_SECRET"),
            allowed_updates: ["message", "callback_query"],
            drop_pending_updates: false,
          });
        } catch {
          await postReleaseStatus(row, "опубликовано, но Telegram webhook не переключился на Production; требуется ручная проверка.");
          return;
        }
        await postReleaseStatus(row, `опубликовано. SHA ${row.commit_sha}; Production deployment ${productionId}.`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    throw new Error(`Production деплой ${productionId} ещё выполняется; проверьте Vercel перед повторными действиями.`);
  } catch (error) {
    const reason = (error instanceof Error ? error.message : "Release failed").slice(0, 1800);
    try {
      await supabase.rpc("staff_record_telegram_qa_release_state", {
        p_approval_id: id, p_status: "failed", p_error: reason,
        p_production_deployment_id: productionId, p_production_url: null,
      });
    } catch { /* Keep the callback response independent from audit availability. */ }
    await postReleaseStatus(row, `публикация не подтверждена. Причина: ${reason}`);
  }
}

export async function POST(request: Request) {
  const secret = process.env.STAFF_QA_WEBHOOK_SECRET;
  const chatId = process.env.STAFF_QA_TELEGRAM_CHAT_ID;
  const threadId = process.env.STAFF_QA_TELEGRAM_THREAD_ID;
  const approverId = Number(process.env.STAFF_QA_TELEGRAM_APPROVER_ID);
  if (!secret || !chatId || !threadId || !process.env.STAFF_QA_BOT_TOKEN || !Number.isSafeInteger(approverId)) {
    return NextResponse.json({ error: "Staff QA webhook is not configured" }, { status: 503 });
  }
  if (!constantTimeSecretMatches(secret, request.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 1_000_000) return NextResponse.json({ error: "Update too large" }, { status: 413 });
  let update: Update;
  try { update = await request.json() as Update; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (update.callback_query) {
    try { await processApprovalCallback(update.callback_query); }
    catch { return NextResponse.json({ error: "Could not process release callback" }, { status: 503 }); }
    return NextResponse.json({ ok: true, action: "release_callback_processed" });
  }

  const message = update.message;
  if (!message) return NextResponse.json({ ok: true, ignored: "unsupported_update" });
  if (message.chat.type === "private" && /^\/start(?:@\w+)?(?:\s|$)/i.test(message.text ?? "")) {
    const senderId = message.from?.id;
    if (senderId === approverId && message.chat.id === approverId) {
      await telegramCall("sendMessage", { chat_id: approverId, text: "Staff QA bot подключён. Запросы на публикацию будут приходить сюда." }).catch(() => undefined);
    }
    return NextResponse.json({ ok: true, action: senderId === approverId ? "owner_started_bot" : "ignored_private_start" });
  }
  if (String(message.chat.id) !== chatId || String(message.message_thread_id ?? "") !== threadId) {
    return NextResponse.json({ ok: true, ignored: "outside_configured_topic" });
  }
  const updateId = update.update_id;
  const photo = message.photo?.at(-1);
  if (!Number.isSafeInteger(updateId) || !Number.isSafeInteger(message.message_id) || !photo) {
    return NextResponse.json({ ok: true, ignored: "photo_required_or_invalid_update" });
  }
  if ((photo.file_size ?? 0) > 10_000_000) return NextResponse.json({ ok: true, ignored: "photo_too_large" });

  const supabase = staffQaSupabase();
  const { data: existing, error: lookupError } = await supabase.from("staff_telegram_qa_reports")
    .select("id,request_no,status")
    .eq("telegram_update_id", updateId!).maybeSingle();
  if (lookupError) return NextResponse.json({ error: "Could not check duplicate update" }, { status: 503 });
  let report: { id: string; request_no: number };
  if (existing) {
    if (existing.status !== "failed") return NextResponse.json({ ok: true, duplicate: true, request_no: existing.request_no });
    const { data: claimed, error: claimError } = await supabase.from("staff_telegram_qa_reports")
      .update({ status: "receiving", last_error: null, updated_at: new Date().toISOString() })
      .eq("id", existing.id).eq("status", "failed").select("id,request_no").maybeSingle();
    if (claimError) return NextResponse.json({ error: "Could not retry failed report" }, { status: 503 });
    if (!claimed) return NextResponse.json({ ok: true, duplicate: true, request_no: existing.request_no });
    report = claimed;
  } else {
    const { data: inserted, error: insertError } = await supabase.from("staff_telegram_qa_reports").insert({
      telegram_update_id: updateId,
      telegram_chat_id: message.chat.id,
      telegram_message_id: message.message_id,
      telegram_thread_id: message.message_thread_id,
      telegram_user_id: message.from?.id ?? null,
      telegram_username: message.from?.username ?? null,
      sender_name: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || null,
      caption: (message.caption ?? "").slice(0, 10000),
      photo_file_id: photo.file_id,
      photo_unique_id: photo.file_unique_id,
      photo_size_bytes: photo.file_size ?? null,
      photo_mime_type: "image/jpeg",
      telegram_sent_at: new Date(message.date * 1000).toISOString(),
    }).select("id,request_no").single();
    if (insertError || !inserted) {
      if (insertError?.code === "23505") return NextResponse.json({ ok: true, duplicate: true });
      return NextResponse.json({ error: "Could not store report" }, { status: 503 });
    }
    report = inserted;
  }

  try {
    await supabase.from("staff_telegram_qa_report_history").insert({
      report_id: report.id, event_type: "received", new_status: "receiving", actor_type: "telegram",
      details: { update_id: updateId },
    });
    const file = await telegramCall<{ file_path?: string }>("getFile", { file_id: photo.file_id });
    if (!file.file_path) throw new Error("Telegram did not return photo path");
    const token = process.env.STAFF_QA_BOT_TOKEN!;
    const downloaded = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`, { cache: "no-store" });
    if (!downloaded.ok) throw new Error("Could not download Telegram photo");
    const bytes = new Uint8Array(await downloaded.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > 10_000_000) throw new Error("Photo size is invalid");
    const path = `${report.id}/${photo.file_unique_id}`;
    const contentType = detectPhotoMime(bytes);
    if (!contentType) throw new Error("Unsupported photo type");
    const { error: uploadError } = await supabase.storage.from(STAFF_QA_BUCKET).upload(path, bytes, { contentType, upsert: true });
    if (uploadError) throw uploadError;
    const { error: updateError } = await supabase.from("staff_telegram_qa_reports").update({
      photo_storage_path: path,
      photo_size_bytes: bytes.byteLength,
      photo_mime_type: contentType,
      status: "new",
      updated_at: new Date().toISOString(),
    }).eq("id", report.id);
    if (updateError) throw updateError;
    await supabase.from("staff_telegram_qa_report_history").insert({
      report_id: report.id, event_type: "photo_saved", old_status: "receiving", new_status: "new", actor_type: "system",
      details: { bytes: bytes.byteLength, mime_type: contentType },
    });
    const ack = await telegramCall<{ message_id: number }>("sendMessage", {
      chat_id: message.chat.id, message_thread_id: message.message_thread_id,
      reply_to_message_id: message.message_id,
      text: `STAFF QA · заявка №${report.request_no} принята.`,
    });
    await supabase.from("staff_telegram_qa_reports").update({ acknowledgement_message_id: ack.message_id, status: "new" }).eq("id", report.id);
    await supabase.from("staff_telegram_qa_report_history").insert({
      report_id: report.id, event_type: "acknowledged", old_status: "new", new_status: "new", actor_type: "telegram",
      details: { acknowledgement_message_id: ack.message_id },
    });
    return NextResponse.json({ ok: true, request_no: report.request_no });
  } catch (error) {
    const reason = (error instanceof Error ? error.message : "Processing error").slice(0, 2000);
    await supabase.from("staff_telegram_qa_reports").update({ status: "failed", last_error: reason, updated_at: new Date().toISOString() }).eq("id", report.id);
    await supabase.from("staff_telegram_qa_report_history").insert({
      report_id: report.id, event_type: "failed", old_status: "receiving", new_status: "failed", actor_type: "system",
      details: { error: reason },
    });
    return NextResponse.json({ error: "Could not process report" }, { status: 503 });
  }
}
