import type { NextRequest } from "next/server";
import { proxyList } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** GET /api/commission/rates. The platform default rate and a page of store rates. Only the known query parameters are forwarded. */
export async function GET(request: NextRequest): Promise<Response> {
  return proxyList(request, "/api/admin/commission/rates", ["page", "limit", "q", "mode"]);
}
