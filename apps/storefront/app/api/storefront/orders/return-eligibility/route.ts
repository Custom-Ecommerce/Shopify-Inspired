import { bffContext, bffRoutes } from "@/lib/bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/storefront/orders/return-eligibility: what may still be returned from a delivered order ({ orderId, phone }), Sprint 5 EP-13. */
export function POST(request: Request): Promise<Response> {
  return bffRoutes.returnEligibility(request, bffContext(request));
}
