import { NextRequest } from "next/server";
import { proxyGet } from "@/lib/proxy";

/** GET /api/dashboard/analytics: store resolved + verified by the proxy, forwarded to `/api/stores/:id/analytics` (the backend re-checks ownership too). */
export async function GET(req: NextRequest) {
  const period = req.nextUrl.searchParams.get("period") ?? "30d";
  return proxyGet(req, (_req, auth) => '/api/analytics', {
    auth: "dashboard",
    logScope: "[api/dashboard/analytics]",
    params: { period },
  });
}
