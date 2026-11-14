import "server-only";

import { resolveClientIp } from "@markaz/platform-kit/client-ip";
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
    clientIp: resolveClientIp(request.headers, process.env),
  };
}
