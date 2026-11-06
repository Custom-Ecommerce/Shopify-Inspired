import type { NextRequest } from "next/server";
import { proxyList } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** GET /api/sync/outbox. Outbox health and a page of events. Only the known query parameters are forwarded. */
export async function GET(request: NextRequest): Promise<Response> {
  return proxyList(request, "/api/admin/sync/outbox", ["page", "limit", "status"]);
}
