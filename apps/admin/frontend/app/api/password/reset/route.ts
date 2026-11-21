import type { NextRequest } from "next/server";
import { proxyPublicPost } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** POST /api/password/reset { token, password } (CO-77): the link works once for 30 minutes. */
export function POST(request: NextRequest): Promise<Response> {
  return proxyPublicPost(request, "/api/admin/password/reset");
}
