import { buildStoreRobotsTxt, canonicalStoreOrigin } from "@markaz/storefront-data";
import { resolveStore } from "@/lib/tenancy/resolve-store";
import { requestOrigin } from "@/lib/request-origin";

/**
 * Sprint 7 (S7-B3): the robots.txt of one store, on the store's own host. A live store is open and points to its sitemap; a store that is not live, a store
 * that cannot be resolved and any preview are closed (Disallow: /), the same rule as the page robots tags (D-078). Built by the data layer.
 */
export async function GET(_request: Request, context: { params: Promise<{ tenantKey: string }> }): Promise<Response> {
  const { tenantKey } = await context.params;
  const result = await resolveStore(tenantKey, "slug");
  const live = result.outcome === "ok" && result.store.status === "active" && result.previewToken === null;
  return new Response(buildStoreRobotsTxt({ origin: canonicalStoreOrigin({ requestOrigin: await requestOrigin(), customDomain: result.outcome === "ok" ? result.store.customDomain : null }), live }), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, s-maxage=300, stale-while-revalidate=600" },
  });
}
