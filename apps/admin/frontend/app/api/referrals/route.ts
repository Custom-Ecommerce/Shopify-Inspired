import type { NextRequest } from "next/server";
import { proxyList } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** GET /api/referrals?status&q&from&to&page&limit (S8-B6). Read only. Only the known filters are forwarded. */
export function GET(request: NextRequest): Promise<Response> {
  return proxyList(request, "/api/admin/referrals", ["status", "q", "from", "to", "page", "limit"]);
}
