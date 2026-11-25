import type { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** GET /api/overview/traffic (S8-B7). Visits and orders per day. Read only, and no query parameter is forwarded. */
export async function GET(request: NextRequest): Promise<Response> {
  return proxyToBackend(request, "/api/admin/overview/traffic");
}
