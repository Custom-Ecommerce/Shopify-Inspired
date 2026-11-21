import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { sellerStoreLimitRequestSchema } from "@/lib/contracts";
import { isObjectId, proxyToBackend } from "@/lib/proxy";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** GET /api/sellers/:id/store-limit (Sprint 6 EP-12.US02.T03). The seller's override, effective limit and where it comes from. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  if (!isObjectId(id)) return NextResponse.json({ error: "Seller not found" }, { status: 404, headers: NO_STORE });
  return proxyToBackend(request, "/api/admin/sellers/" + id + "/store-limit");
}

/**
 * POST /api/sellers/:id/store-limit (Sprint 6 EP-12.US02.T02). Sets (a whole number from 1) or clears (null) the seller's store-limit
 * override, with a reason of 3 to 300 characters. The body is checked here and again by the backend; only { storeLimitOverride, reason } is
 * forwarded.
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
  const input = sellerStoreLimitRequestSchema.safeParse(raw);
  if (!input.success) {
    const issues = input.error.issues.map((issue: { path: PropertyKey[]; message: string }) => ({ path: issue.path.map(String).join("."), message: issue.message }));
    return NextResponse.json({ error: "Invalid request", issues }, { status: 422, headers: NO_STORE });
  }
  return proxyToBackend(request, "/api/admin/sellers/" + id + "/store-limit", { method: "POST", body: JSON.stringify(input.data) });
}
