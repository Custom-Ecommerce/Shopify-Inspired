import { buildStoreSitemapXml, canonicalStoreOrigin } from "@markaz/storefront-data";
import { loadSitemapData } from "@markaz/storefront-data/server";
import { resolveStore } from "@/lib/tenancy/resolve-store";
import { resolveTransport } from "@/lib/sources";
import { requestOrigin } from "@/lib/request-origin";

/**
 * Sprint 7 (S7-B3): the sitemap of one store, on the store's own host (the middleware rewrites /sitemap.xml here). It lists the home page, the catalogue,
 * the blog, every PUBLISHED article and every PUBLISHED page, each with its canonical address. A draft is not in it (the lists it is built from are the
 * public ones). A store that is not live, and any preview, has no sitemap: 404. The page is built by the data layer (buildStoreSitemapXml, which has a
 * check file); this file only fetches and answers.
 */
export async function GET(_request: Request, context: { params: Promise<{ tenantKey: string }> }): Promise<Response> {
  const { tenantKey } = await context.params;
  const result = await resolveStore(tenantKey, "slug");
  if (result.outcome !== "ok" || result.store.status !== "active" || result.previewToken !== null) return new Response("Not found", { status: 404 });
  const transport = await resolveTransport({ kind: "tenant", key: tenantKey });
  if (!transport) return new Response("Not found", { status: 404 });
  const xml = buildStoreSitemapXml({ origin: canonicalStoreOrigin({ requestOrigin: await requestOrigin(), customDomain: result.store.customDomain }), ...(await loadSitemapData(transport)) });
  if (xml === null) return new Response("Not found", { status: 404 });
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, s-maxage=300, stale-while-revalidate=600" } });
}
