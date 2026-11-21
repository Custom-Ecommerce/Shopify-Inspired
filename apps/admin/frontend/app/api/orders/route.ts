import type { NextRequest } from "next/server";
import { proxyList } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** GET /api/orders (Sprint 6 S6-B5): every store's orders, safe fields only. Only the known filters are forwarded (never a phone or an email). */
export function GET(request: NextRequest): Promise<Response> {
  return proxyList(request, "/api/admin/orders", ["store", "status", "from", "to", "q", "page", "limit"]);
}
