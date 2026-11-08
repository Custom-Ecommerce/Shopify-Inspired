import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

/**
 * POST /api/dashboard/orders/:id/notes (EP-02 OB-5a)
 *
 * Forwards the JSON body { text }, the seller's session and the active store header to the seller backend's
 * POST /api/orders/:id/notes, which adds an internal note. `bindStore` is off: the order is scoped by x-store-id.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyPost(req, `/api/orders/${encodeURIComponent(id)}/notes`, {
    auth: "dashboard",
    bindStore: false,
    logScope: "[api/dashboard/orders/:id/notes]",
  });
}
