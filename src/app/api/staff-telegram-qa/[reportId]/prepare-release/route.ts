import { NextResponse } from "next/server";
import { staffQaSupabase, staffQaWorkerAuthorized, telegramCall } from "@/lib/staff-telegram-qa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Deployment = {
  id?: string; uid?: string; url?: string; projectId?: string; readyState?: string; target?: string | null;
  gitSource?: { sha?: string } | null; meta?: Record<string, string>;
};

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export async function POST(request: Request, context: { params: Promise<{ reportId: string }> }) {
  if (!staffQaWorkerAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { reportId } = await context.params;
  let body: { deployment_id?: string; summary?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.deployment_id || body.deployment_id.length > 128 || !body.summary?.trim() || body.summary.length > 4000) {
    return NextResponse.json({ error: "Preview deployment and summary are required" }, { status: 400 });
  }
  try {
    const teamId = requiredEnv("STAFF_QA_VERCEL_TEAM_ID");
    const projectId = requiredEnv("STAFF_QA_VERCEL_PROJECT_ID");
    const token = requiredEnv("STAFF_QA_VERCEL_TOKEN");
    const deploymentUrl = new URL(`/v13/deployments/${encodeURIComponent(body.deployment_id)}?teamId=${encodeURIComponent(teamId)}&withGitRepoInfo=true`, "https://api.vercel.com");
    const response = await fetch(deploymentUrl, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const deployment = await response.json() as Deployment;
    const sha = (deployment.gitSource?.sha ?? deployment.meta?.githubCommitSha ?? deployment.meta?.gitCommitSha ?? "").toLowerCase();
    const candidateUrl = deployment.url ? `https://${deployment.url}` : "";
    if (!response.ok || (deployment.id ?? deployment.uid) !== body.deployment_id || deployment.projectId !== projectId ||
        deployment.readyState !== "READY" || deployment.target === "production" || !/^[0-9a-f]{40,64}$/.test(sha) ||
        !candidateUrl || new URL(candidateUrl).hostname.endsWith(".vercel.app") === false) {
      return NextResponse.json({ error: "Not a ready Preview deployment for this Staff project" }, { status: 422 });
    }

    const supabase = staffQaSupabase();
    const { data: report, error: reportError } = await supabase.from("staff_telegram_qa_reports")
      .select("id,request_no,status,review_summary")
      .eq("id", reportId).maybeSingle();
    if (reportError || !report || report.status !== "reviewed") return NextResponse.json({ error: "Review the report before requesting publication" }, { status: 409 });
    const { data: approval, error: insertError } = await supabase.from("staff_telegram_qa_release_approvals").insert({
      report_id: report.id,
      preview_deployment_id: body.deployment_id,
      preview_url: candidateUrl,
      commit_sha: sha,
      summary: body.summary.trim(),
      status: "pending",
    }).select("id").single();
    if (insertError || !approval) return NextResponse.json({ error: "An active approval may already exist for this request" }, { status: 409 });

    const approverId = Number(requiredEnv("STAFF_QA_TELEGRAM_APPROVER_ID"));
    const text = [
      "STAFF · СОГЛАСОВАНИЕ ПУБЛИКАЦИИ",
      `Заявка №${report.request_no}`,
      `Исправление: ${body.summary.trim()}`,
      `Preview: ${candidateUrl}`,
      `Коммит: ${sha}`,
      "Публикация затронет только Do4a Staff.",
    ].join("\n\n");
    try {
      const sent = await telegramCall<{ message_id: number }>("sendMessage", {
        chat_id: approverId,
        text,
        reply_markup: { inline_keyboard: [[
          { text: "Опубликовать", callback_data: `staffqa:publish:${approval.id}` },
          { text: "Не публиковать", callback_data: `staffqa:reject:${approval.id}` },
        ]] },
      });
      await supabase.from("staff_telegram_qa_release_approvals").update({ telegram_approval_message_id: sent.message_id, updated_at: new Date().toISOString() }).eq("id", approval.id);
      await supabase.from("staff_telegram_qa_release_history").insert({ approval_id: approval.id, event_type: "requested", details: { report_no: report.request_no } });
    } catch {
      await supabase.from("staff_telegram_qa_release_approvals").update({ status: "failed", last_error: "Could not DM owner; owner must start the Staff QA bot before approval requests can be sent", updated_at: new Date().toISOString() }).eq("id", approval.id);
      await supabase.from("staff_telegram_qa_release_history").insert({ approval_id: approval.id, event_type: "failed", details: { reason: "owner_dm_failed" } });
      return NextResponse.json({ error: "Could not send approval DM. Open the Staff QA bot and send /start first." }, { status: 503 });
    }
    return NextResponse.json({ ok: true, approval_id: approval.id, preview_url: candidateUrl, commit_sha: sha });
  } catch {
    return NextResponse.json({ error: "Could not prepare publication approval" }, { status: 503 });
  }
}
