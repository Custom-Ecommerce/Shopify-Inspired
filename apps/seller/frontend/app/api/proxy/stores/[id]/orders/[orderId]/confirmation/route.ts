import { NextRequest } from "next/server";
import { proxyStorePostBody } from "@/lib/store-proxy";

/** POST /api/proxy/stores/:id/orders/:orderId/confirmation { result: confirmed | unreachable | cancel, note? }: the seller's phone confirmation decision (Sprint 5 EP-11.US01). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; orderId: string }> }) {
  const { id, orderId } = await params;
  return proxyStorePostBody(req, id, `orders/${encodeURIComponent(orderId)}/confirmation`, "[proxy store order confirmation]");
}
