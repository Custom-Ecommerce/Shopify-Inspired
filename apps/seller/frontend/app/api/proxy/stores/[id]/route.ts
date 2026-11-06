import { NextRequest } from "next/server";
import { apiError, proxyPatch, ProxyResponseError } from "@/lib/proxy";

/** Only these top-level groups of the Stores document may be written from the dashboard (§6.4). */
const ALLOWED_GROUPS: ReadonlySet<string> = new Set(["name", "storefront", "paymentSettings", "courierSettings"]);

/**
 * PATCH /api/proxy/stores/:id — goes through the shared proxy
 * (`storeScope: "required"`): the active store is verified against
 * `user.stores`, the path id must equal that active store, and only the
 * allow-listed field groups may be written.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return proxyPatch(req, `/api/stores/${encodeURIComponent(id)}`, {
    auth: "dashboard",
    storeScope: "required",
    bindStore: false, // the body targets the Stores document itself
    logScope: "[proxy stores]",
    guard: (_req, auth) =>
      auth.storeId !== id ? apiError(403, "STORE_FORBIDDEN", "You do not have access to this store.") : null,
    body: (incoming: unknown) => {
      if (typeof incoming !== "object" || incoming === null || Array.isArray(incoming)) {
        throw new ProxyResponseError(apiError(400, "INVALID_BODY", "Expected a JSON object body."));
      }
      const rejected = Object.keys(incoming).filter((k) => !ALLOWED_GROUPS.has(k));
      if (rejected.length > 0) {
        throw new ProxyResponseError(
          apiError(400, "FIELD_NOT_ALLOWED", "This request contains fields that cannot be changed here.", {
            details: { fields: rejected, allowed: [...ALLOWED_GROUPS] },
          })
        );
      }
      return incoming;
    },
  });
}
