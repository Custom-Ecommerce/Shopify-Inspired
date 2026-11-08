import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

/**
 * POST /api/dashboard/orders/:id/tracking (EP-02 OB-4)
 *
 * Forwards the JSON body { courier?, trackingNumber?, trackingUrl? }, the seller's session and the active store header to
 * the seller backend's POST /api/orders/:id/tracking, which edits the courier and tracking of a dispatched order.
 * `bindStore` is off, as on the status and cancel proxies: the order is scoped by the x-store-id header.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyPost(req, `/api/orders/${encodeURIComponent(id)}/tracking`, {
    auth: "dashboard",
    bindStore: false,
    logScope: "[api/dashboard/orders/:id/tracking]",
  });
}
