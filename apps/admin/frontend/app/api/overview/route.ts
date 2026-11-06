import type { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** GET /api/overview. The platform's headline numbers. Read only, and no query parameter is forwarded. */
export async function GET(request: NextRequest): Promise<Response> {
  return proxyToBackend(request, "/api/admin/overview");
}
