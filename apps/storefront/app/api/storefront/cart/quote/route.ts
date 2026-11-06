import { bffContext, bffRoutes } from "@/lib/bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/storefront/cart/quote: prices the shopper's cart. The contract lives in createBffRoutes. */
export function POST(request: Request): Promise<Response> {
  return bffRoutes.quote(request, bffContext(request));
}
