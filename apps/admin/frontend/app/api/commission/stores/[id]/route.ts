import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isObjectId, proxyToBackend } from "@/lib/proxy";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

type Context = { params: Promise<{ id: string }> };

/** Only { rate, reason } is forwarded; the backend checks both again (rate 0 to 100, one decimal; reason 3 to 500 characters). */
async function forward(request: NextRequest, context: Context, method: "PUT" | "DELETE"): Promise<Response> {
  const { id } = await context.params;
  if (!isObjectId(id)) return NextResponse.json({ error: "Store not found" }, { status: 404, headers: NO_STORE });
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400, headers: NO_STORE });
  }
  const record = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const body = method === "PUT" ? { rate: record.rate, reason: record.reason } : { reason: record.reason };
  return proxyToBackend(request, "/api/admin/commission/stores/" + id, { method, body: JSON.stringify(body) });
}

/** GET /api/commission/stores/:id: the store's rate and mode. */
export async function GET(request: NextRequest, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isObjectId(id)) return NextResponse.json({ error: "Store not found" }, { status: 404, headers: NO_STORE });
  return proxyToBackend(request, "/api/admin/commission/stores/" + id);
}

/** PUT /api/commission/stores/:id { rate, reason }. */
export function PUT(request: NextRequest, context: Context): Promise<Response> {
  return forward(request, context, "PUT");
}

/** DELETE /api/commission/stores/:id { reason }: back to the platform default. */
export function DELETE(request: NextRequest, context: Context): Promise<Response> {
  return forward(request, context, "DELETE");
}
