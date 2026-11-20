import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isObjectId, proxyToBackend } from "@/lib/proxy";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const REASON_MAX = 500;

/** POST /api/payouts/:id/void { reason }. Only the reason is forwarded; the backend checks it again (3 to 500 characters). */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  if (!isObjectId(id)) return NextResponse.json({ error: "Payout not found" }, { status: 404, headers: NO_STORE });
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400, headers: NO_STORE });
  }
  const reason = typeof (raw as { reason?: unknown } | null)?.reason === "string" ? (raw as { reason: string }).reason.trim().slice(0, REASON_MAX) : "";
  return proxyToBackend(request, "/api/admin/payouts/" + id + "/void", { method: "POST", body: JSON.stringify({ reason }) });
}
