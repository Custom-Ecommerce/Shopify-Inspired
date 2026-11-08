import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

/**
 * POST /api/dashboard/orders/:id/status (EP-02 OB-2)
 *
 * Forwards the JSON body { status, note?, courier?, trackingNumber?, trackingUrl? }, the seller's session and the active
 * store header to the seller backend's POST /api/orders/:id/transition, which validates the move, writes it and answers
 * { changed, order }. `bindStore` is off: the order is scoped by the x-store-id header, and `store` is not part of the
 * transition request.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyPost(req, `/api/orders/${encodeURIComponent(id)}/transition`, {
    auth: "dashboard",
    bindStore: false,
    logScope: "[api/dashboard/orders/:id/status]",
  });
}
