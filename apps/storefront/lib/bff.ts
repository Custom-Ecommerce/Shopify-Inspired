import "server-only";

import { createBffRoutes, type BffRouteContext } from "@markaz/storefront-data/server";
import { resolveOrderTransport } from "@/lib/sources";

/**
 * The storefront's same-origin API for orders and quotes. The seller backend's address stays on this server: a browser
 * only ever calls these routes, on the store's own host.
 */
export const bffRoutes = createBffRoutes({ lookupStore: resolveOrderTransport });

/**
 * The trusted parts of a request, read from headers that middleware and the edge proxy set. Nothing comes from the body,
 * so a shopper cannot choose the store, or the address the backend sees.
 */
export function bffContext(request: Request): BffRouteContext {
  const kind = request.headers.get("x-markaz-kind");
  const tenant = request.headers.get("x-markaz-tenant");
  return {
    tenantKey: kind === "tenant" && tenant ? tenant.toLowerCase() : null,
    clientIp: clientIpOf(request.headers),
  };
}

/**
 * The rightmost forwarded address is the one the nearest proxy appended. The leftmost entries are whatever the shopper
 * sent, so trusting them would let a shopper dodge the backend's per-client limits.
 */
function clientIpOf(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  const real = headers.get("x-real-ip")?.trim();
  return real ? real : null;
}
