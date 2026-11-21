import { bffContext, bffRoutes } from "@/lib/bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/storefront/orders/reviews: reviews a product of a delivered order ({ orderId, phone, productId, rating, title, body, displayName }), Sprint 5 EP-21. */
export function POST(request: Request): Promise<Response> {
  return bffRoutes.submitReview(request, bffContext(request));
}
