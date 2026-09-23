import type { CatalogCampaign } from "./types";

function config() {
  const url = process.env.SUPABASE_URL || "https://lptzejmdtsmnlxfodihr.supabase.co";
  // Catalog reads are protected by RLS and can use the publishable/anon key.
  // Keep the service role key for server-only admin and media mutations.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxwdHplam1kdHNtbmx4Zm9kaWhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNjc2MjQsImV4cCI6MjA5OTY0MzYyNH0.VMG5eWULDR34Q5vHoMXCJgiJuhozKxIO0SVT3C3ncvc";
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

export async function getPublishedCatalog(): Promise<CatalogCampaign[]> {
  const c = config();
  if (!c) return [];
  const headers = { apikey: c.key, Authorization: `Bearer ${c.key}` };
  const campaigns = await fetch(`${c.url}/rest/v1/campaigns?active=eq.true&order=created_at.asc`, { headers, cache: "no-store" });
  if (!campaigns.ok) throw new Error(`Catalog campaigns request failed: ${campaigns.status}`);
  const rows = await campaigns.json() as Array<Record<string, unknown>>;
  const result: CatalogCampaign[] = [];
  for (const row of rows) {
    const menusResponse = await fetch(`${c.url}/rest/v1/menus?campaign_id=eq.${row.id}&order=sort_order.asc`, { headers, cache: "no-store" });
    if (!menusResponse.ok) throw new Error(`Catalog menus request failed: ${menusResponse.status}`);
    const menus = await menusResponse.json() as Array<Record<string, unknown>>;
    const mapped = [];
    for (const menu of menus) {
      const productsResponse = await fetch(`${c.url}/rest/v1/products?menu_id=eq.${menu.id}&order=sort_order.asc`, { headers, cache: "no-store" });
      if (!productsResponse.ok) throw new Error(`Catalog products request failed: ${productsResponse.status}`);
      mapped.push({ ...menu, products: await productsResponse.json() });
    }
    result.push({ ...row, menus: mapped } as CatalogCampaign);
  }
  return result;
}
