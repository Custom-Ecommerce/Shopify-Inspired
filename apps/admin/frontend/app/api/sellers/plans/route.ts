import type { NextRequest } from "next/server";
import { proxyList } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** GET /api/sellers/plans?ids=a,b (Sprint 6 EP-14.US02.T08). The plan, status and usage of the sellers on the page. Only `ids` is forwarded. */
export async function GET(request: NextRequest): Promise<Response> {
  return proxyList(request, "/api/admin/sellers/plans", ["ids"]);
}
