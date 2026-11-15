import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { backendFetch, BackendUnavailableError } from "@/lib/backend";
import { clientAddressHeaders } from "@/lib/client-address";
import { SESSION_COOKIE } from "@/lib/cookie";
import { proxyList } from "@/lib/proxy";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const FORWARDED = ["storeId", "period", "from", "to"] as const;

/**
 * GET /api/commission/report?storeId&period&from&to[&format=csv]. The commission report of one store and period. With
 * format=csv the CSV the backend builds is passed through as a download; anything else is the JSON the console reads.
 * Only the known query parameters are forwarded.
 */
export async function GET(request: NextRequest): Promise<Response> {
  if (request.nextUrl.searchParams.get("format") !== "csv") return proxyList(request, "/api/admin/commission/report", FORWARDED);

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "Authentication required" }, { status: 401, headers: NO_STORE });
  const forwarded = new URLSearchParams();
  for (const name of FORWARDED) {
    const value = request.nextUrl.searchParams.get(name);
    if (value !== null && value !== "") forwarded.set(name, value);
  }
  forwarded.set("format", "csv");

  let upstream: Response;
  try {
    upstream = await backendFetch("/api/admin/commission/report?" + forwarded.toString(), {
      method: "GET",
      headers: { authorization: "Bearer " + token, ...clientAddressHeaders(request.headers) },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof BackendUnavailableError ? err.message : "The admin backend is unavailable" }, { status: 503, headers: NO_STORE });
  }
  if (!upstream.ok) {
    const payload = (await upstream.json().catch(() => null)) as { error?: unknown } | null;
    const known = [400, 401, 403, 404, 409, 422, 503].includes(upstream.status);
    return NextResponse.json(
      { error: typeof payload?.error === "string" ? payload.error : "The report could not be made" },
      { status: known ? upstream.status : 502, headers: NO_STORE },
    );
  }
  return new Response(await upstream.text(), {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": upstream.headers.get("content-disposition") ?? 'attachment; filename="commission-report.csv"',
    },
  });
}
