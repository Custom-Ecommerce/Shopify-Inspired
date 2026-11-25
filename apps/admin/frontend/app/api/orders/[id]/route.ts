import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isObjectId, proxyToBackend } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** GET /api/orders/:id (Sprint 6 S6-B5): one order's items, totals and history. Every read is audited by the backend. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  if (!isObjectId(id)) return NextResponse.json({ error: "Order not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return proxyToBackend(request, "/api/admin/orders/" + id);
}
