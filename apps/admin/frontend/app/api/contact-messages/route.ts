import type { NextRequest } from "next/server";
import { proxyList } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** GET /api/contact-messages (Sprint 7, S7-B4): the platform's own contact messages. The capability (contact.read) is checked by the backend. */
export function GET(request: NextRequest): Promise<Response> {
  return proxyList(request, "/api/admin/contact-messages", ["status", "page", "limit"]);
}
