import type { NextRequest } from "next/server";
import { proxyList } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** GET /api/audit. The audit log. Only the known query parameters are forwarded to the backend. */
export async function GET(request: NextRequest): Promise<Response> {
  return proxyList(request, "/api/admin/audit", ["page", "limit", "q", "action"]);
}
