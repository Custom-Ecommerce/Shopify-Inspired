import "server-only";

import { headers } from "next/headers";
import { cleanOrigin } from "@markaz/storefront-data";

/**
 * The address this request came in on (the store's own host), for absolute links: the sitemap, robots.txt and the canonical address. Null when it cannot be
 * read or is not an http(s) origin. The origin is cleaned by the data layer (cleanOrigin), so a forged forwarded header can never print a bad address.
 */
export async function requestOrigin(): Promise<string | null> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (!host) return null;
    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    return cleanOrigin(proto + "://" + host);
  } catch {
    return null;
  }
}
