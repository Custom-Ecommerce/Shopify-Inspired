import type { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** GET /api/notifications/failed (S6-B7): the failed emails (kind, masked recipient, attempts, error code, dates; never the body). */
export function GET(request: NextRequest): Promise<Response> {
  return proxyToBackend(request, "/api/admin/notifications/failed");
}
