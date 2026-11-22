import "server-only";

import { headers } from "next/headers";
import { forwardedHostTrusted, requestHostWithPort } from "@markaz/platform-kit/tenancy-host";
import { cleanOrigin } from "@markaz/storefront-data";

/**
 * The address this request came in on (the store's own host), for absolute links: the sitemap, robots.txt and the canonical address. Null when it cannot be
 * read or is not an http(s) origin. The origin is cleaned by the data layer (cleanOrigin), so a forged forwarded header can never print a bad address.
 */
export async function requestOrigin(): Promise<string | null> {
  try {
    const h = await headers();
    // S7-B6: the forwarded host and protocol are believed only where a trusted proxy writes them (the same rule as the middleware).
    const host = requestHostWithPort(h, process.env);
    if (!host) return null;
    const forwardedProto = forwardedHostTrusted(process.env) ? h.get("x-forwarded-proto") : null;
    const proto = forwardedProto ?? (host.startsWith("localhost") || host.includes(".localhost") ? "http" : "https");
    return cleanOrigin(proto + "://" + host);
  } catch {
    return null;
  }
}
