import { bffContext, bffRoutes } from "@/lib/bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/storefront/reviews: a product's approved reviews ({ slug, page }), Sprint 5 EP-21. Read on the server under the product's cache tag. */
export function POST(request: Request): Promise<Response> {
  return bffRoutes.productReviews(request, bffContext(request));
}
