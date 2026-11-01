import { NextResponse } from "next/server";
import { staffQaSupabase, staffQaWorkerAuthorized, STAFF_QA_BUCKET } from "@/lib/staff-telegram-qa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ reportId: string }> }) {
  if (!staffQaWorkerAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { reportId } = await context.params;
  const { data: report, error } = await staffQaSupabase().from("staff_telegram_qa_reports")
    .select("photo_storage_path,photo_mime_type")
    .eq("id", reportId).maybeSingle();
  if (error || !report?.photo_storage_path) return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  const { data: photo, error: downloadError } = await staffQaSupabase().storage.from(STAFF_QA_BUCKET).download(report.photo_storage_path);
  if (downloadError || !photo) return NextResponse.json({ error: "Photo unavailable" }, { status: 503 });
  return new Response(photo, { headers: {
    "Content-Type": report.photo_mime_type ?? "application/octet-stream",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}
