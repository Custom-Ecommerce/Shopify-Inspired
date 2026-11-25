import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { backendFetch, BackendUnavailableError } from "@/lib/backend";
import { SESSION_COOKIE } from "@/lib/cookie";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const ALLOWED = ["q", "action", "from", "to"] as const;

/**
 * GET /api/audit/export?q&action&from&to (Sprint 6 S6-B6). The audit CSV, owner level only: the backend enforces it and audits the export. Only the known
 * filters are forwarded. The file comes back as it is (UTF-8 with a BOM); a refusal keeps its status and words.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "Authentication required" }, { status: 401, headers: NO_STORE });
  const forwarded = new URLSearchParams();
  for (const name of ALLOWED) {
    const value = request.nextUrl.searchParams.get(name);
    if (value !== null && value !== "") forwarded.set(name, value);
  }
  const query = forwarded.toString();
  let upstream: Response;
  try {
    upstream = await backendFetch("/api/admin/audit/export" + (query === "" ? "" : "?" + query), { headers: { authorization: "Bearer " + token } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof BackendUnavailableError ? err.message : "The admin backend is unavailable" }, { status: 503, headers: NO_STORE });
  }
  if (!upstream.ok) {
    const payload = (await upstream.json().catch(() => null)) as { error?: unknown } | null;
    const status = [400, 401, 403, 503].includes(upstream.status) ? upstream.status : 502;
    return NextResponse.json({ error: typeof payload?.error === "string" ? payload.error : "The export could not be made" }, { status, headers: NO_STORE });
  }
  return new Response(await upstream.arrayBuffer(), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="audit-log.csv"',
      "x-export-truncated": upstream.headers.get("x-export-truncated") ?? "false",
      ...NO_STORE,
    },
  });
}
