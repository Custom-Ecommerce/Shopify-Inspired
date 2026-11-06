import { bffContext, bffRoutes } from "@/lib/bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/storefront/orders/lookup: finds an order by its id and the phone it was placed with. */
export function POST(request: Request): Promise<Response> {
  return bffRoutes.lookup(request, bffContext(request));
}
