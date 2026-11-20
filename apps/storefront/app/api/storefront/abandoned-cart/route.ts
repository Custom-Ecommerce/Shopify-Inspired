import { bffContext, bffRoutes } from "@/lib/bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/storefront/abandoned-cart: keeps the shopper's cart for the seller ({ phone, email, consent: true, lines }), Sprint 5 EP-28. */
export function POST(request: Request): Promise<Response> {
  return bffRoutes.abandonedCart(request, bffContext(request));
}
