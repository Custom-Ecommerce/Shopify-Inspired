import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

/**
 * POST /api/dashboard/orders/:id/cancel (EP-02 OB-3)
 *
 * Forwards the JSON body { reason, note? }, the seller's session and the active store header to the seller backend's
 * POST /api/orders/:id/cancel, which cancels the order and gives its stock back. `bindStore` is off, as on the status
 * proxy: the order is scoped by the x-store-id header, and `store` is not part of the cancel request.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyPost(req, `/api/orders/${encodeURIComponent(id)}/cancel`, {
    auth: "dashboard",
    bindStore: false,
    logScope: "[api/dashboard/orders/:id/cancel]",
  });
}
