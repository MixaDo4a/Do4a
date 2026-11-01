import { NextResponse } from "next/server";
import { staffQaSupabase, staffQaWorkerAuthorized } from "@/lib/staff-telegram-qa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!staffQaWorkerAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await staffQaSupabase().rpc("staff_claim_next_telegram_qa_report");
  if (error) return NextResponse.json({ error: "Could not claim QA report" }, { status: 503 });
  return NextResponse.json({ report: data?.[0] ?? null });
}
