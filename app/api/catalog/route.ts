import { NextResponse } from "next/server";
import { getPublishedCatalog } from "@/lib/catalog/server";

export async function GET() {
  try {
    const campaigns = await getPublishedCatalog();
    return NextResponse.json({ campaigns, configured: campaigns.length > 0 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Catalog request failed" }, { status: 502 });
  }
}
