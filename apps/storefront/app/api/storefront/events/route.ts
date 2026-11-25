import { bffContext, bffRoutes } from "@/lib/bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/storefront/events { event, productSlug? }: an anonymous counter of this host's store (S8-B6). No cookie is read or set for it. */
export function POST(request: Request): Promise<Response> {
  return bffRoutes.event(request, bffContext(request));
}
