import type { NextRequest } from "next/server";
import { proxyList } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** GET /api/reviews. Every store's reviews (Sprint 5 EP-21.US01.T05). Only the known filters are forwarded. */
export function GET(request: NextRequest): Promise<Response> {
  return proxyList(request, "/api/admin/reviews", ["page", "limit", "storeId", "status"]);
}
