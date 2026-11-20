import type { NextRequest } from "next/server";
import { proxyList } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** GET /api/commission/history. Who changed which commission rate, newest first. Only the known query parameters are forwarded. */
export async function GET(request: NextRequest): Promise<Response> {
  return proxyList(request, "/api/admin/commission/history", ["page", "limit", "storeId", "scope"]);
}
