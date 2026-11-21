import { NextRequest } from "next/server";
import { proxyStorePostBody } from "@/lib/store-proxy";

/** POST /api/proxy/stores/:id/returns/:returnId/reject: requested -> rejected with { reason }. The backend validates every field. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; returnId: string }> }) {
  const { id, returnId } = await params;
  return proxyStorePostBody(req, id, `returns/${encodeURIComponent(returnId)}/reject`, "[proxy store return reject]");
}
