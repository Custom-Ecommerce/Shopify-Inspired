import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isObjectId, proxyToBackend } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** GET /api/stores/:id. One store with its owner and governance history. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  if (!isObjectId(id)) return NextResponse.json({ error: "Store not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return proxyToBackend(request, "/api/admin/stores/" + id);
}
