import type { NextRequest } from "next/server";
import { proxyPublicPost } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** POST /api/invite/accept { token, password } (S6-B6): an invited admin sets their password; the link works once for 7 days. */
export function POST(request: NextRequest): Promise<Response> {
  return proxyPublicPost(request, "/api/admin/invite/accept");
}
