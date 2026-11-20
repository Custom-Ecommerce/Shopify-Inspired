import { bffContext, bffRoutes } from "@/lib/bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/storefront/orders/returns: asks for a return ({ orderId, phone, items, reasonCode, note }), Sprint 5 EP-13. */
export function POST(request: Request): Promise<Response> {
  return bffRoutes.requestReturn(request, bffContext(request));
}
