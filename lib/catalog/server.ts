import type { CatalogCampaign } from "./types";

function config() {
  const url = process.env.SUPABASE_URL;
  // Catalog reads are protected by RLS and can use the publishable/anon key.
  // Keep the service role key for server-only admin and media mutations.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
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
