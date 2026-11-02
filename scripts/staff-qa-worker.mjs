import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import path from "node:path";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const baseUrl = process.env.STAFF_QA_PREVIEW_URL?.replace(/\/$/, "");
const workerToken = process.env.STAFF_QA_PREVIEW_WORKER_TOKEN;
const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
if (!baseUrl || !workerToken) throw new Error("Staff QA Preview worker configuration is missing");

async function api(route, { method = "POST", body, binary = false } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${workerToken}`,
      ...(protectionBypass ? { "x-vercel-protection-bypass": protectionBypass } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (binary) {
    if (!response.ok) throw new Error(`Photo request failed (${response.status})`);
    if (!contentType.startsWith("image/")) throw new Error("Photo endpoint returned a non-image response");
    const bytes = Buffer.from(await response.arrayBuffer());
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isWebp = bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    if (!isJpeg && !isPng && !isWebp) throw new Error("Photo response did not contain a supported image file");
    return { bytes, mime: contentType };
  }
  if (!contentType.includes("application/json")) throw new Error("Staff QA endpoint returned a non-JSON response (check Preview protection bypass)");
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? `Staff QA request failed (${response.status})`);
  return result;
}

async function readStdinJson() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return JSON.parse(input);
}

const command = process.argv[2];
if (command === "next") {
  const result = await api("/api/staff-telegram-qa/next");
  const report = result.report;
  if (!report) {
    process.stdout.write(JSON.stringify({ report: null }));
  } else {
    try {
      const photo = await api(`/api/staff-telegram-qa/${encodeURIComponent(report.id)}/photo`, { method: "GET", binary: true });
      const ext = photo.mime.includes("png") ? ".png" : photo.mime.includes("webp") ? ".webp" : ".jpg";
      const directory = path.join(tmpdir(), "do4a-staff-qa");
      mkdirSync(directory, { recursive: true });
      const photoPath = path.join(directory, `request-${report.request_no}${ext}`);
      await pipeline(Readable.from(photo.bytes), createWriteStream(photoPath));
      process.stdout.write(JSON.stringify({
        report_id: report.id,
        request_no: report.request_no,
        caption: report.caption,
        sender_name: report.sender_name,
        telegram_username: report.telegram_username,
        created_at: report.created_at,
        photo_path: photoPath,
      }));
    } catch (error) {
      await api(`/api/staff-telegram-qa/${encodeURIComponent(report.id)}/release`, {
        body: { error: "Could not load the protected report photo for review" },
      }).catch(() => undefined);
      throw error;
    }
  }
} else if (command === "review") {
  const { report_id, ...review } = await readStdinJson();
  if (!report_id) throw new Error("report_id is required");
  process.stdout.write(JSON.stringify(await api(`/api/staff-telegram-qa/${encodeURIComponent(report_id)}/review`, { body: review })));
} else if (command === "release") {
  const { report_id, error } = await readStdinJson();
  if (!report_id) throw new Error("report_id is required");
  process.stdout.write(JSON.stringify(await api(`/api/staff-telegram-qa/${encodeURIComponent(report_id)}/release`, { body: { error } })));
} else if (command === "prepare-release") {
  const { report_id, ...release } = await readStdinJson();
  if (!report_id) throw new Error("report_id is required");
  process.stdout.write(JSON.stringify(await api(`/api/staff-telegram-qa/${encodeURIComponent(report_id)}/prepare-release`, { body: release })));
} else {
  throw new Error("Command must be next, review, release, or prepare-release");
}
