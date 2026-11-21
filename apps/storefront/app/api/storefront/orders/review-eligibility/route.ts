import { bffContext, bffRoutes } from "@/lib/bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/storefront/orders/review-eligibility: the delivered products of an order that have no review yet ({ orderId, phone }), Sprint 5 EP-21. */
export function POST(request: Request): Promise<Response> {
  return bffRoutes.reviewEligibility(request, bffContext(request));
}
