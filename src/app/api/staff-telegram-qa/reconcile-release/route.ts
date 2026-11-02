import { NextResponse } from "next/server";
import { registerStaffQaWebhook, staffQaSupabase, staffQaWorkerAuthorized, telegramCall } from "@/lib/staff-telegram-qa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ApprovalRow = {
  id: string; report_id: string; commit_sha: string; status: string;
  production_deployment_id: string | null; production_url: string | null; last_error: string | null;
};
type Deployment = {
  id?: string; uid?: string; url?: string; projectId?: string; readyState?: string; target?: string | null;
  aliasAssigned?: boolean; aliasError?: { message?: string } | null;
  gitSource?: { sha?: string } | null; meta?: Record<string, string>;
  errorCode?: string; errorMessage?: string;
};

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function deploymentSha(deployment: Deployment) {
  return (deployment.gitSource?.sha ?? deployment.meta?.githubCommitSha ?? deployment.meta?.gitCommitSha ?? "").toLowerCase();
}

async function terminalEvent(approvalId: string, eventType: "published" | "failed") {
  const { data, error } = await staffQaSupabase().from("staff_telegram_qa_release_history")
    .select("id,details").eq("approval_id", approvalId).eq("event_type", eventType)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("Could not check final notification history");
  return data;
}

export async function POST(request: Request) {
  if (!staffQaWorkerAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.VERCEL_ENV !== "preview") return NextResponse.json({ error: "Release reconciliation must originate from Preview" }, { status: 403 });

  let body: { approval_id?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.approval_id || !/^[0-9a-f-]{36}$/i.test(body.approval_id)) {
    return NextResponse.json({ error: "Approval ID is required" }, { status: 400 });
  }

  const supabase = staffQaSupabase();
  const { data: approval, error: approvalError } = await supabase.from("staff_telegram_qa_release_approvals")
    .select("id,report_id,commit_sha,status,production_deployment_id,production_url,last_error")
    .eq("id", body.approval_id).maybeSingle<ApprovalRow>();
  if (approvalError || !approval) return NextResponse.json({ error: "Approval not found" }, { status: 404 });
  if (!approval.production_deployment_id || !["deploying", "published"].includes(approval.status)) {
    return NextResponse.json({ error: "Approval is not awaiting Production reconciliation" }, { status: 409 });
  }

  try {
    const teamId = requiredEnv("STAFF_QA_VERCEL_TEAM_ID");
    const projectId = requiredEnv("STAFF_QA_VERCEL_PROJECT_ID");
    const token = requiredEnv("STAFF_QA_VERCEL_TOKEN");
    const deploymentUrl = new URL(`/v13/deployments/${encodeURIComponent(approval.production_deployment_id)}?teamId=${encodeURIComponent(teamId)}&withGitRepoInfo=true`, "https://api.vercel.com");
    const response = await fetch(deploymentUrl, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const deployment = await response.json() as Deployment;
    if (!response.ok || (deployment.id ?? deployment.uid) !== approval.production_deployment_id
      || deployment.projectId !== projectId || deployment.target !== "production"
      || deploymentSha(deployment) !== approval.commit_sha.toLowerCase()) {
      return NextResponse.json({ error: "Production deployment does not match the approved project and SHA" }, { status: 409 });
    }

    if (deployment.readyState === "ERROR" || deployment.readyState === "CANCELED") {
      const reason = `Production deployment ${deployment.readyState}: ${deployment.errorCode ?? ""} ${deployment.errorMessage ?? ""}`.trim().slice(0, 1000);
      if (approval.status === "deploying") {
        const { error } = await supabase.rpc("staff_record_telegram_qa_release_state", {
          p_approval_id: approval.id, p_status: "failed", p_error: reason,
          p_production_deployment_id: approval.production_deployment_id, p_production_url: null,
        });
        if (error) throw new Error("Could not record failed Production deployment");
      }
      await registerStaffQaWebhook(requiredEnv("STAFF_QA_PRODUCTION_URL")).catch(() => undefined);
      await notifyFinal(approval, "not_published", reason);
      return NextResponse.json({ ok: true, status: "failed" });
    }

    if (deployment.readyState !== "READY") {
      return NextResponse.json({ ok: true, status: "deploying" }, { status: 202 });
    }
    if (!deployment.aliasAssigned) {
      return NextResponse.json({ error: `Production alias is not assigned: ${deployment.aliasError?.message ?? "pending"}` }, { status: 202 });
    }

    if (approval.status === "deploying") {
      const { error } = await supabase.rpc("staff_record_telegram_qa_release_state", {
        p_approval_id: approval.id, p_status: "published", p_error: null,
        p_production_deployment_id: approval.production_deployment_id,
        p_production_url: deployment.url ? `https://${deployment.url}` : requiredEnv("STAFF_QA_PRODUCTION_URL"),
      });
      if (error) throw new Error("Could not record successful Production deployment");
    }

    let webhookRestored = true;
    try { await registerStaffQaWebhook(requiredEnv("STAFF_QA_PRODUCTION_URL")); }
    catch { webhookRestored = false; }
    const reason = webhookRestored
      ? `Production deployment is Ready and its alias is assigned. SHA ${approval.commit_sha}.`
      : `Production deployment is Ready and its alias is assigned (SHA ${approval.commit_sha}), but Telegram webhook could not be restored.`;
    await notifyFinal(approval, "published", reason);
    return NextResponse.json({ ok: true, status: "published", final_notifications: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Release reconciliation failed";
    return NextResponse.json({ error: message.slice(0, 300) }, { status: 503 });
  }
}

async function notifyFinal(approval: ApprovalRow, outcome: "published" | "not_published", reason: string) {
  const supabase = staffQaSupabase();
  const { data: report, error: reportError } = await supabase.from("staff_telegram_qa_reports")
    .select("request_no,telegram_chat_id,telegram_thread_id").eq("id", approval.report_id).maybeSingle();
  if (reportError || !report) throw new Error("Could not load the original QA topic");
  const requestLabel = `заявка №${report.request_no}`;
  const text = [`STAFF QA · ${requestLabel}`, `Итог: ${outcome === "published" ? "опубликовано" : "не опубликовано"}.`, `Причина: ${reason}`].join("\n\n");

  const event = await terminalEvent(approval.id, outcome === "published" ? "published" : "failed");
  if (!event) throw new Error("Terminal release event is missing");
  const details = (event.details ?? {}) as Record<string, unknown>;
  if (typeof details.group_message_id !== "number") {
    const sent = await telegramCall<{ message_id: number }>("sendMessage", {
      chat_id: report.telegram_chat_id,
      message_thread_id: report.telegram_thread_id,
      text,
    });
    const { error } = await supabase.from("staff_telegram_qa_release_history").update({
      details: { ...details, group_message_id: sent.message_id, group_notified: true, outcome },
    }).eq("id", event.id);
    if (error) throw new Error("Group result was sent but its delivery was not recorded");
  }

  const refreshed = await terminalEvent(approval.id, outcome === "published" ? "published" : "failed");
  const latestDetails = (refreshed?.details ?? {}) as Record<string, unknown>;
  if (typeof latestDetails.owner_message_id !== "number") {
    const sent = await telegramCall<{ message_id: number }>("sendMessage", {
      chat_id: Number(requiredEnv("STAFF_QA_TELEGRAM_APPROVER_ID")), text,
    });
    const { error } = await supabase.from("staff_telegram_qa_release_history").update({
      details: { ...latestDetails, owner_message_id: sent.message_id, owner_notified: true, outcome },
    }).eq("id", refreshed!.id);
    if (error) throw new Error("Owner result was sent but its delivery was not recorded");
  }
}
