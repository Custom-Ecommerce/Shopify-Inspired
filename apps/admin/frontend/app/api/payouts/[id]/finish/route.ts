import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isObjectId, proxyToBackend } from "@/lib/proxy";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** POST /api/payouts/:id/finish. Finish or release a payout stuck in pending_settle. No body is forwarded. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  if (!isObjectId(id)) return NextResponse.json({ error: "Payout not found" }, { status: 404, headers: NO_STORE });
  return proxyToBackend(request, "/api/admin/payouts/" + id + "/finish", { method: "POST" });
}
