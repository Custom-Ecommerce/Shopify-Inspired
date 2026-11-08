import { bffContext, bffRoutes } from "@/lib/bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/storefront/products?ids=: the Live products behind the favourites. The contract lives in createBffRoutes. */
export function GET(request: Request): Promise<Response> {
  return bffRoutes.products(request, bffContext(request));
}
