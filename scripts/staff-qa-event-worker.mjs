import { createClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { access, mkdir, open, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const previewUrl = process.env.STAFF_QA_PREVIEW_URL?.replace(/\/$/, "");
const workerToken = process.env.STAFF_QA_PREVIEW_WORKER_TOKEN;
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const realtimeKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const maxPhotoBytes = 10 * 1024 * 1024;
const tables = {
  reports: "staff_telegram_qa_reports",
  questions: "staff_telegram_qa_owner_questions",
  releases: "staff_telegram_qa_release_approvals",
};

function log(message) {
  const safe = [workerToken, realtimeKey, bypass].filter(Boolean).reduce((text, secret) => text.split(secret).join("[redacted]"), message);
  const line = `[${new Date().toISOString()}] ${safe}\n`;
  process.stderr.write(`[staff-qa-event-worker] ${safe}\n`);
  if (process.env.LOCALAPPDATA) {
    const directory = path.join(process.env.LOCALAPPDATA, "Do4aStaff", "staff-qa-worker");
    try { mkdirSync(directory, { recursive: true }); appendFileSync(path.join(directory, "worker.log"), line, { encoding: "utf8", mode: 0o600 }); } catch { /* Logging must not stop queue work. */ }
  }
}

function requireConfig() {
  if (process.platform !== "win32") throw new Error("This scheduled worker currently targets Windows");
  if (!previewUrl || !/^https:\/\//i.test(previewUrl)) throw new Error("STAFF_QA_PREVIEW_URL must be HTTPS");
  if (!workerToken) throw new Error("STAFF_QA_PREVIEW_WORKER_TOKEN is missing");
  if (!supabaseUrl || !/^https:\/\//i.test(supabaseUrl)) throw new Error("SUPABASE_URL must be HTTPS");
  if (!realtimeKey) throw new Error("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is missing");
  const host = new URL(previewUrl).hostname;
  if (!host.endsWith(".vercel.app")) throw new Error("STAFF_QA_PREVIEW_URL must be the verified Vercel Preview deployment URL");
}

async function api(route, { method = "POST", body, image = false } = {}) {
  const response = await fetch(`${previewUrl}/api/staff-telegram-qa${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${workerToken}`,
      ...(bypass ? { "x-vercel-protection-bypass": bypass } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
    signal: AbortSignal.timeout(image ? 60_000 : 90_000),
  });
  if (image) {
    if (!response.ok) throw new Error(`Protected image endpoint returned HTTP ${response.status}`);
    const mime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (!mime || !["image/jpeg", "image/png", "image/webp"].includes(mime)) throw new Error("Protected image endpoint returned an unsupported type");
    const bytes = Buffer.from(await response.arrayBuffer());
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const webp = bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    if (!bytes.length || bytes.length > maxPhotoBytes || !(jpeg || png || webp)) throw new Error("Image is empty, oversized, or its signature does not match the supported formats");
    return { bytes, mime };
  }
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : `Staff QA endpoint returned HTTP ${response.status}`);
  return result;
}

function extension(mime) {
  return ({ "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" })[mime];
}

function codexEnvironment() {
  const allow = ["PATH", "Path", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "HOMEDRIVE", "HOMEPATH", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "CODEX_HOME", "TERM", "LANG"];
  return Object.fromEntries(allow.filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
}

async function createTaskWorktree(taskId) {
  const taskRoot = path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), "Do4aStaff", "staff-qa-worker", "worktrees");
  await mkdir(taskRoot, { recursive: true });
  const directory = path.join(taskRoot, `${taskId}-${randomUUID().slice(0, 8)}`);
  const git = await run("git", ["worktree", "add", "--detach", directory, "HEAD"], { cwd: repoRoot, env: codexEnvironment() });
  if (git.code !== 0) throw new Error("Could not create an isolated task worktree");
  try { await symlink(path.join(repoRoot, "node_modules"), path.join(directory, "node_modules"), "junction"); } catch { /* Dependencies can be installed in the isolated worktree when needed. */ }
  return directory;
}

async function codexEntryPoint() {
  const candidates = [];
  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, "npm", "node_modules", "@openai", "codex", "bin", "codex.js"));
  if (process.env.USERPROFILE) candidates.push(path.join(process.env.USERPROFILE, "AppData", "Roaming", "npm", "node_modules", "@openai", "codex", "bin", "codex.js"));
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { /* Try the next standard Windows installation path. */ }
  }
  throw new Error("Codex CLI was not found in this Windows user's npm installation");
}

async function removeTaskWorktree(directory) {
  await run("git", ["worktree", "remove", "--force", directory], { cwd: repoRoot, env: codexEnvironment() }).catch(() => undefined);
  await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  await run("git", ["worktree", "prune"], { cwd: repoRoot, env: codexEnvironment() }).catch(() => undefined);
}

function run(command, args, { cwd, env, input, timeoutMs = 4 * 60 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ["pipe", "ignore", "ignore"] });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.once("error", reject);
    child.once("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1 }); });
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function runCodex({ kind, taskId, imagePath, context }) {
  const worktree = await createTaskWorktree(taskId);
  const outputPath = path.join(worktree, `.staff-qa-result-${randomUUID()}.json`);
  const schemaPath = path.join(worktree, "scripts", "staff-qa-agent-result.schema.json");
  const promptPath = path.join(worktree, "scripts", "staff-qa-agent-prompt.md");
  try {
    const prompt = `${await readFile(promptPath, "utf8")}\n## Task kind\n${kind}\n\n\`\`\`json\n${JSON.stringify(context)}\n\`\`\`\n`;
    const args = ["exec", "--ephemeral", "--approve-for-me", "--output-schema", schemaPath, "--output-last-message", outputPath, "--image", imagePath, "-C", worktree, "-"];
    const codexPath = await codexEntryPoint();
    const result = await run(process.execPath, [codexPath, ...args], { cwd: worktree, env: codexEnvironment(), input: prompt });
    if (result.code !== 0) throw new Error(`Codex exited with status ${result.code}`);
    const output = JSON.parse(await readFile(outputPath, "utf8"));
    return output;
  } finally {
    await removeTaskWorktree(worktree);
  }
}

async function withReportPhoto(report, callback) {
  const { bytes, mime } = await api(`/${encodeURIComponent(report.id)}/photo`, { method: "GET", image: true });
  const directory = path.join(os.tmpdir(), "do4a-staff-qa-images", randomUUID());
  await mkdir(directory, { recursive: true });
  const photoPath = path.join(directory, `report${extension(mime)}`);
  try {
    await writeFile(photoPath, bytes, { mode: 0o600, flag: "wx" });
    return await callback(photoPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function processReport(report) {
  return withReportPhoto(report, async (photoPath) => {
    const finding = await runCodex({
      kind: "new_report",
      taskId: `report-${report.request_no}`,
      imagePath: photoPath,
      context: { kind: "report", id: report.id, request_no: report.request_no, caption: report.caption, sender_name: report.sender_name, telegram_username: report.telegram_username, created_at: report.created_at },
    });
    if (finding.action === "retry") throw new Error(finding.next_step || "Review needs retry");
    if (finding.action === "ask_owner") {
      if (!finding.owner_question?.trim()) throw new Error("Owner question is missing");
      await api(`/${encodeURIComponent(report.id)}/ask-owner`, { body: { question: finding.owner_question, context: finding.owner_context ?? "" } });
      return;
    }
    if (finding.category === "bug" && (!/^[0-9a-f]{40,64}$/i.test(finding.commit_sha ?? "") || !finding.deployment_id?.trim())) {
      throw new Error("A bug review requires a pushed commit and matching verified Ready Preview deployment");
    }
    const saved = await api(`/${encodeURIComponent(report.id)}/review`, { body: {
      category: finding.category,
      summary: finding.summary,
      basis: finding.basis,
      next_step: finding.next_step,
      ignore: finding.ignore,
    } });
    if (finding.category === "bug" && saved.review_saved) {
      pendingPreparations.set(report.id, { deployment_id: finding.deployment_id, summary: finding.summary });
      await attemptPreparation(report.id);
    }
  });
}

async function attemptPreparation(reportId) {
  const preparation = pendingPreparations.get(reportId);
  if (!preparation) return;
  try {
    await api(`/${encodeURIComponent(reportId)}/prepare-release`, { body: preparation });
    pendingPreparations.delete(reportId);
  } catch (error) {
    log(`Release approval for report ${reportId.slice(0, 8)} is not prepared yet: ${error.message}`);
    scheduleRetry(`prepare-${reportId}`);
  }
}

async function processOwnerAnswer(answer) {
  const report = answer.staff_telegram_qa_reports;
  if (!report?.id || !report?.request_no) throw new Error("Owner answer is missing its linked report");
  return withReportPhoto(report, async (photoPath) => {
    const outcome = await runCodex({
      kind: "owner_answer",
      taskId: `owner-${answer.id}`,
      imagePath: photoPath,
      context: { kind: "owner_answer", question_id: answer.id, question: answer.question, context: answer.context, response_type: answer.response_type, response_text: answer.response_text, answered_at: answer.answered_at, report: { id: report.id, request_no: report.request_no, caption: report.caption } },
    });
    if (outcome.action === "retry" || outcome.action === "ask_owner") throw new Error(outcome.next_step || outcome.owner_question || "Owner response needs clarification");
    const declined = answer.response_type === "no" || /^(нет|не делаем)(?:\b|[,!.])/i.test(answer.response_text?.trim() ?? "");
    if (!declined && outcome.category === "bug" && (!/^[0-9a-f]{40,64}$/i.test(outcome.commit_sha ?? "") || !outcome.deployment_id?.trim())) {
      throw new Error("The approved code change has no verified Ready Preview deployment");
    }
    const review = {
      category: declined ? "question" : outcome.category,
      summary: outcome.summary,
      basis: outcome.basis,
      next_step: declined ? (outcome.next_step || "Closed by owner decision; no requested change was made.") : outcome.next_step,
      ignore: declined || outcome.ignore,
    };
    const resolved = await api(`/owner-questions/${encodeURIComponent(answer.id)}/resolve`, { body: {
      summary: outcome.resolution_summary || outcome.summary,
      review,
    } });
    if (!declined && outcome.category === "bug" && !resolved.already_resolved) {
      pendingPreparations.set(report.id, { deployment_id: outcome.deployment_id, summary: outcome.summary });
      await attemptPreparation(report.id);
    }
  });
}

let channel;
let supabase;
let running = false;
let rerun = false;
const pendingQuestions = new Set();
const pendingReleases = new Map();
const pendingPreparations = new Map();
const retryTimers = new Map();

function scheduleRetry(key, delayMs = 60 * 60 * 1000) {
  if (retryTimers.has(key)) return;
  const timer = setTimeout(() => {
    retryTimers.delete(key);
    requestDrain(`delayed retry (${key})`);
  }, delayMs);
  timer.unref();
  retryTimers.set(key, timer);
}

function requestDrain(reason) {
  log(`Realtime event: ${reason}`);
  rerun = true;
  void drain();
}

async function checkReleases() {
  for (const [id, attempt] of pendingReleases) {
    if (attempt >= 8) { pendingReleases.delete(id); continue; }
    try {
      const result = await api("/reconcile-release", { body: { approval_id: id } });
      if (["published", "failed"].includes(result.status)) {
        pendingReleases.delete(id);
        continue;
      }
    } catch (error) {
      log(`Release ${String(id).slice(0, 8)} reconciliation will retry: ${error.message}`);
    }
    {
      pendingReleases.set(id, attempt + 1);
      setTimeout(() => { if (pendingReleases.has(id)) requestDrain(`release ${String(id).slice(0, 8)} reconciliation retry`); }, 15_000).unref();
    }
  }
}

async function recoverDeployments() {
  const { data, error } = await supabase.from(tables.releases).select("id").eq("status", "deploying").limit(20);
  if (error) throw new Error("Could not recover pending release checks");
  for (const row of data ?? []) pendingReleases.set(row.id, 0);
}

async function drain() {
  if (running) return;
  running = true;
  try {
    do {
      rerun = false;
      for (const reportId of pendingPreparations.keys()) await attemptPreparation(reportId);
      const answers = await api("/owner-answers", { method: "GET" });
      for (const answer of answers.answers ?? []) {
        if (pendingQuestions.has(answer.id)) continue;
        pendingQuestions.add(answer.id);
        try { await processOwnerAnswer(answer); }
        catch (error) {
          log(`Owner answer ${String(answer.id).slice(0, 8)} remains pending: ${error.message}`);
          scheduleRetry(`owner-${answer.id}`);
        }
        finally { pendingQuestions.delete(answer.id); }
      }
      while (true) {
        const next = await api("/next");
        if (!next.report) break;
        try { await processReport(next.report); }
        catch (error) {
          await api(`/${encodeURIComponent(next.report.id)}/release`, { body: { error: "Local event worker could not safely finish review; retry after resolving the worker issue." } }).catch(() => undefined);
          log(`Report ${next.report.request_no} was returned for retry: ${error.message}`);
          scheduleRetry(`report-${next.report.id}`);
          break;
        }
      }
      await checkReleases();
    } while (rerun);
  } catch (error) {
    log(`Drain stopped; waiting for next Realtime event/reconnect: ${error.message}`);
  } finally {
    running = false;
    if (rerun) void drain();
  }
}

async function acquireLock() {
  const lockDir = path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), "Do4aStaff", "staff-qa-worker");
  await mkdir(lockDir, { recursive: true });
  const lockPath = path.join(lockDir, "worker.lock");
  try {
    const handle = await open(lockPath, "wx");
    await handle.writeFile(String(process.pid));
    await handle.close();
    return async () => {
      if ((await readFile(lockPath, "utf8").catch(() => "")) === String(process.pid)) await rm(lockPath, { force: true });
    };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const pid = Number(await readFile(lockPath, "utf8").catch(() => "0"));
    if (Number.isInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); throw new Error("A Staff QA event worker is already running"); }
      catch (probe) { if (probe.message === "A Staff QA event worker is already running") throw probe; }
    }
    await rm(lockPath, { force: true });
    return acquireLock();
  }
}

async function main() {
  requireConfig();
  if (!process.env.CODEX_HOME && !process.env.USERPROFILE) throw new Error("Codex CLI user configuration is unavailable");
  const codexPath = await codexEntryPoint();
  const codex = await run(process.execPath, [codexPath, "--version"], { cwd: repoRoot, env: codexEnvironment(), timeoutMs: 10_000 });
  if (codex.code !== 0) throw new Error("Codex CLI is not available for the scheduled-task user");
  if (process.argv.includes("--check")) {
    log("Configuration and Codex CLI verified; no database connection was opened.");
    return;
  }
  const releaseLock = await acquireLock();
  supabase = createClient(supabaseUrl, realtimeKey, { auth: { autoRefreshToken: false, persistSession: false } });
  channel = supabase.channel("local-staff-telegram-qa-worker");
  channel
    .on("postgres_changes", { event: "INSERT", schema: "public", table: tables.reports }, () => requestDrain("new report"))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "staff_telegram_qa_report_history", filter: "event_type=eq.acknowledged" }, () => requestDrain("report acknowledged"))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: tables.questions, filter: "status=eq.answered" }, (payload) => requestDrain(`owner answer ${String(payload.new?.id ?? "").slice(0, 8)}`))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: tables.releases, filter: "status=eq.deploying" }, (payload) => {
      const id = payload.new?.id;
      if (id) { pendingReleases.set(id, 0); requestDrain(`release ${String(id).slice(0, 8)} awaiting reconciliation`); }
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        void recoverDeployments().catch((error) => log(error.message)).finally(() => requestDrain("Realtime connected; recovering durable backlog"));
      }
      if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) log(`Realtime channel state: ${status}; waiting for reconnect`);
    });

  log("Listening to Staff QA Realtime; no recurring queue polling is enabled.");
  const shutdown = async () => {
    try { await supabase.removeChannel(channel); } catch { /* best-effort */ }
    await releaseLock();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.once("exit", () => { void releaseLock(); });
}

main().catch((error) => {
  log(error.message);
  process.exitCode = 1;
});
