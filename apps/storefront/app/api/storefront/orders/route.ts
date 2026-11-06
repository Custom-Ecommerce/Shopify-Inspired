import { bffContext, bffRoutes } from "@/lib/bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/storefront/orders: places an order. Requires an Idempotency-Key header. */
export function POST(request: Request): Promise<Response> {
  return bffRoutes.submit(request, bffContext(request));
}
