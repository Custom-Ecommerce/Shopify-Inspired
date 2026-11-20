import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isObjectId, proxyToBackend } from "@/lib/proxy";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * POST /api/payouts/details { storeId }. The full payout account of one store, for the operator who sends the money. A POST,
 * so it is never cached or prefetched. The backend audits every call. The answer is not stored by this route.
 */
export async function POST(request: NextRequest): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400, headers: NO_STORE });
  }
  const storeId = typeof (raw as { storeId?: unknown } | null)?.storeId === "string" ? (raw as { storeId: string }).storeId : "";
  if (!isObjectId(storeId)) return NextResponse.json({ error: "Store not found" }, { status: 404, headers: NO_STORE });
  return proxyToBackend(request, "/api/admin/payouts/details", { method: "POST", body: JSON.stringify({ storeId }) });
}
