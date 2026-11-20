import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { proxyList, proxyToBackend } from "@/lib/proxy";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** GET /api/payouts. The payout history (a payout stuck in pending_settle included). Only the known query parameters are forwarded. */
export async function GET(request: NextRequest): Promise<Response> {
  return proxyList(request, "/api/admin/payouts", ["page", "limit", "storeId", "status"]);
}

/**
 * POST /api/payouts { storeId, expectedBalance, method, reference, note }. Only those fields are forwarded; the backend checks
 * them again and the seller backend decides whether the balance still matches.
 */
export async function POST(request: NextRequest): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400, headers: NO_STORE });
  }
  const record = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const body = {
    storeId: record.storeId,
    expectedBalance: record.expectedBalance,
    method: record.method,
    reference: record.reference,
    note: record.note,
  };
  return proxyToBackend(request, "/api/admin/payouts", { method: "POST", body: JSON.stringify(body) });
}
