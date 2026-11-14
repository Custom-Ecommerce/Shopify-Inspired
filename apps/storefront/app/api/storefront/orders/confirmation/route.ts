import { bffContext, bffRoutes } from "@/lib/bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/storefront/orders/confirmation: the tab that placed an order reads it back with its token, not a phone number. */
export function POST(request: Request): Promise<Response> {
  return bffRoutes.confirmation(request, bffContext(request));
}
