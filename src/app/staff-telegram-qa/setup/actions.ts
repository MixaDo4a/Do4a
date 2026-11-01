"use server";

import { redirect } from "next/navigation";
import { telegramCall } from "@/lib/staff-telegram-qa";

export async function registerPreviewWebhook() {
  if (process.env.VERCEL_ENV !== "preview") redirect("/staff-telegram-qa/setup?result=preview-only");

  const host = process.env.VERCEL_URL;
  const botToken = process.env.STAFF_QA_BOT_TOKEN;
  const webhookSecret = process.env.STAFF_QA_WEBHOOK_SECRET;
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!host || !host.endsWith(".vercel.app") || !botToken || !webhookSecret || !bypassSecret) {
    redirect("/staff-telegram-qa/setup?result=not-configured");
  }

  const webhookUrl = new URL("/api/staff-telegram-qa/webhook", `https://${host}`);
  webhookUrl.searchParams.set("x-vercel-protection-bypass", bypassSecret);

  try {
    await telegramCall<boolean>("setWebhook", {
      url: webhookUrl.toString(),
      secret_token: webhookSecret,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
    });
  } catch {
    redirect("/staff-telegram-qa/setup?result=failed");
  }

  redirect("/staff-telegram-qa/setup?result=registered");
}
