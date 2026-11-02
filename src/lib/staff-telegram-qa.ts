import { timingSafeEqual } from "node:crypto";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

export const STAFF_QA_BUCKET = "staff-telegram-qa";

export function constantTimeSecretMatches(expected: string | undefined, supplied: string | null) {
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function staffQaWorkerAuthorized(request: Request) {
  const previewToken = process.env.VERCEL_ENV === "preview"
    ? process.env.STAFF_QA_PREVIEW_WORKER_TOKEN
    : undefined;
  return constantTimeSecretMatches(
    previewToken || process.env.STAFF_QA_WORKER_TOKEN,
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null,
  );
}

export function staffQaSupabase() {
  return createSupabaseServiceRoleClient();
}

export async function telegramCall<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const token = process.env.STAFF_QA_BOT_TOKEN;
  if (!token) throw new Error("Staff QA bot is not configured");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const result = await response.json() as { ok?: boolean; result?: T };
  if (!response.ok || !result.ok || result.result === undefined) throw new Error(`Telegram ${method} failed`);
  return result.result;
}

export async function registerStaffQaWebhook(baseUrl: string, protectedPreview = false) {
  const webhookUrl = new URL("/api/staff-telegram-qa/webhook", baseUrl);
  if (protectedPreview) {
    const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    if (!bypassSecret) throw new Error("Preview webhook bypass is not configured");
    webhookUrl.searchParams.set("x-vercel-protection-bypass", bypassSecret);
  }

  await telegramCall<boolean>("setWebhook", {
    url: webhookUrl.toString(),
    secret_token: process.env.STAFF_QA_WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
  const webhook = await telegramCall<{ url?: string }>("getWebhookInfo", {});
  if (webhook.url !== webhookUrl.toString()) throw new Error("Staff QA webhook target could not be verified");
}

export function workerJson(request: Request) {
  return staffQaWorkerAuthorized(request);
}
