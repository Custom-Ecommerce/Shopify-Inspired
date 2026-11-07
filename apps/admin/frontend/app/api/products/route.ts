import type { NextRequest } from "next/server";
import { proxyList } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** GET /api/products. Every store's products. Only the known filters are forwarded. */
export function GET(request: NextRequest): Promise<Response> {
  return proxyList(request, "/api/admin/products", ["page", "limit", "storeId", "status", "q"]);
}
