import { NextRequest } from "next/server";
import { proxyStorePost } from "@/lib/store-proxy";

/** POST /api/proxy/stores/:id/returns/:returnId/approve: requested -> approved. No body is forwarded. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; returnId: string }> }) {
  const { id, returnId } = await params;
  return proxyStorePost(req, id, `returns/${encodeURIComponent(returnId)}/approve`, "[proxy store return approve]");
}
