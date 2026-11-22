import type { NextRequest } from "next/server";
import { proxyList } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** GET /api/tickets (Sprint 7, S7-B4): every seller's support tickets. Only the known filters are forwarded. The capability (tickets.read) is checked by the backend. */
export function GET(request: NextRequest): Promise<Response> {
  return proxyList(request, "/api/admin/tickets", ["status", "page", "limit"]);
}
