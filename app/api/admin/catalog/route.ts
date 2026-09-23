import { NextResponse } from "next/server";

export const runtime = "nodejs";

function cfg() {
  const url = process.env.SUPABASE_URL || "https://lptzejmdtsmnlxfodihr.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxwdHplam1kdHNtbmx4Zm9kaWhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNjc2MjQsImV4cCI6MjA5OTY0MzYyNH0.VMG5eWULDR34Q5vHoMXCJgiJuhozKxIO0SVT3C3ncvc";
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}

function authorized(request: Request) {
  const token = process.env.ADMIN_TOKEN;
  return !token || request.headers.get("x-admin-token") === token;
}

const allowed = new Set(["campaigns", "menus", "products", "addon_groups", "addons", "product_addon_groups"]);

export async function GET(request: Request) {
  const c = cfg();
  if (!c) return NextResponse.json({ error: "Supabase admin is not configured" }, { status: 503 });
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const entity = new URL(request.url).searchParams.get("entity") || "campaigns";
  if (!allowed.has(entity)) return NextResponse.json({ error: "Unknown entity" }, { status: 400 });
  const order = entity === "campaigns" ? "created_at.asc" : "sort_order.asc";
  const response = await fetch(`${c.url}/rest/v1/${entity}?select=*&order=${order}`, { headers: { apikey: c.key, Authorization: `Bearer ${c.key}` }, cache: "no-store" });
  return NextResponse.json(await response.json(), { status: response.status });
}

export async function POST(request: Request) {
  const c = cfg();
  if (!c) return NextResponse.json({ error: "Supabase admin is not configured" }, { status: 503 });
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json() as { entity?: string; data?: Record<string, unknown> };
  if (!body.entity || !allowed.has(body.entity) || !body.data) return NextResponse.json({ error: "entity and data are required" }, { status: 400 });
  const response = await fetch(`${c.url}/rest/v1/${body.entity}`, { method: "POST", headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(body.data) });
  return NextResponse.json(await response.json(), { status: response.status });
}

export async function PATCH(request: Request) {
  const c = cfg();
  if (!c) return NextResponse.json({ error: "Supabase admin is not configured" }, { status: 503 });
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json() as { entity?: string; id?: string; data?: Record<string, unknown> };
  if (!body.entity || !allowed.has(body.entity) || !body.id || !body.data) return NextResponse.json({ error: "entity, id and data are required" }, { status: 400 });
  const response = await fetch(`${c.url}/rest/v1/${body.entity}?id=eq.${encodeURIComponent(body.id)}`, { method: "PATCH", headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(body.data) });
  return NextResponse.json(await response.json(), { status: response.status });
}

export async function DELETE(request: Request) {
  const c = cfg();
  if (!c) return NextResponse.json({ error: "Supabase admin is not configured" }, { status: 503 });
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json() as { entity?: string; id?: string };
  if (!body.entity || !allowed.has(body.entity) || !body.id) return NextResponse.json({ error: "entity and id are required" }, { status: 400 });
  const response = await fetch(`${c.url}/rest/v1/${body.entity}?id=eq.${encodeURIComponent(body.id)}`, { method: "DELETE", headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, Prefer: "return=minimal" } });
  return new NextResponse(null, { status: response.status });
}
