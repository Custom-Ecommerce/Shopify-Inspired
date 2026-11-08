import { bffContext, bffRoutes } from "@/lib/bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/storefront/orders/track: customer tracking (EP-02 OB-4, D-069). The same body as the lookup ({ orderId, phone }),
 * but the answer is only the parcel's journey: status, step dates, courier and tracking.
 */
export function POST(request: Request): Promise<Response> {
  return bffRoutes.track(request, bffContext(request));
}
