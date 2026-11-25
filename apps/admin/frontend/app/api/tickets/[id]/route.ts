import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isObjectId, proxyToBackend } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** GET /api/tickets/:id (Sprint 7, S7-B4): one ticket with its messages (plain text). */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  if (!isObjectId(id)) return NextResponse.json({ error: "Ticket not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return proxyToBackend(request, "/api/admin/tickets/" + id);
}
