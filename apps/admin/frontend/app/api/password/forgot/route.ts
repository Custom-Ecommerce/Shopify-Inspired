import type { NextRequest } from "next/server";
import { proxyPublicPost } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** POST /api/password/forgot { email } (CO-77): always the same answer, whether or not the account exists. */
export function POST(request: NextRequest): Promise<Response> {
  return proxyPublicPost(request, "/api/admin/password/forgot");
}
