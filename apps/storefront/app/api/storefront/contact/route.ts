import { bffContext, bffRoutes } from "@/lib/bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/storefront/contact: a shopper's message to the store ({ name, email?, phone?, message, consent: true, website? }), Sprint 7 (S7-B4). Success only once the store has kept it. */
export function POST(request: Request): Promise<Response> {
  return bffRoutes.contact(request, bffContext(request));
}
