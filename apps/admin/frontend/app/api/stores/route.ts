import type { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/proxy";

export const dynamic = "force-dynamic";

const FORWARDED = ["page", "limit", "q", "status"];

/** GET /api/stores. The store list. Only the known query parameters are forwarded to the backend. */
export async function GET(request: NextRequest): Promise<Response> {
  const forwarded = new URLSearchParams();
  for (const name of FORWARDED) {
    const value = request.nextUrl.searchParams.get(name);
    if (value !== null && value !== "") forwarded.set(name, value);
  }
  const query = forwarded.toString();
  return proxyToBackend(request, "/api/admin/stores" + (query === "" ? "" : "?" + query));
}
