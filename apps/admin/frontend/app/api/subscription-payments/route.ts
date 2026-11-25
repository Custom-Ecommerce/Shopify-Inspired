import type { NextRequest } from "next/server";
import { proxyList } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** GET /api/subscription-payments?status&page&limit (Sprint 6 EP-14, S6-B4). The manual subscription payments, newest first. Only the known filters are forwarded. */
export function GET(request: NextRequest): Promise<Response> {
  return proxyList(request, "/api/admin/subscription-payments", ["status", "page", "limit"]);
}
