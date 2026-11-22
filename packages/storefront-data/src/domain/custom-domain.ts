import { cleanRequestHost } from "@markaz/platform-kit/tenancy-host";
import { cleanOrigin } from "./content";

/**
 * S7-B6 (D-118): the address a store's pages call their own. A store with a VERIFIED custom domain is canonical on that domain (https), whichever
 * host the request came in on, so its platform subdomain, which keeps working, is not indexed as a second copy. A store without one is canonical
 * on the host the request came in on. Pure. `customDomain` comes from the public store record, which carries it only when it is verified.
 */
export function canonicalStoreOrigin(input: { requestOrigin: string | null | undefined; customDomain: string | null | undefined }): string | null {
  const host = input.customDomain ? cleanRequestHost(input.customDomain) : null;
  if (host !== null) return cleanOrigin("https://" + host);
  return cleanOrigin(input.requestOrigin);
}

/**
 * S7-B7: the origin of a sitemap.xml and a robots.txt. Each host lists ONLY its own addresses (a sitemap may not list another host), so this is the host the
 * request came in on, never the canonical custom domain. The canonical TAG of a page (alternates.canonical with metadataBase) still uses canonicalStoreOrigin.
 */
export function feedOrigin(requestOrigin: string | null | undefined): string | null {
  return cleanOrigin(requestOrigin);
}
