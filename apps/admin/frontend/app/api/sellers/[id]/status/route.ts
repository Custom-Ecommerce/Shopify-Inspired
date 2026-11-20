import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isObjectId, proxyToBackend } from "@/lib/proxy";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const REASON_MAX = 300;

/**
 * POST /api/sellers/:id/status (Sprint 4 EP-08.US03.T02). Suspend or unsuspend a seller account. Only { status, reason }
 * is forwarded; the backend checks both again (reason 3..300 characters to suspend).
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  if (!isObjectId(id)) return NextResponse.json({ error: "Seller not found" }, { status: 404, headers: NO_STORE });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400, headers: NO_STORE });
  }
  const record = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const status = record.status === "suspended" || record.status === "active" ? record.status : null;
  const reason = typeof record.reason === "string" ? record.reason.trim().slice(0, REASON_MAX) : undefined;
  if (status === null) {
    return NextResponse.json({ error: "status must be suspended or active", field: "status" }, { status: 400, headers: NO_STORE });
  }
  const body = status === "suspended" ? { status, reason: reason ?? "" } : { status };
  return proxyToBackend(request, "/api/admin/sellers/" + id + "/status", { method: "POST", body: JSON.stringify(body) });
}
