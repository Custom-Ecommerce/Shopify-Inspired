import { NextRequest } from "next/server";
import { proxyStoreGet } from "@/lib/store-proxy";

/** GET /api/proxy/stores/:id/returns/:returnId: one return with its lines, what was received and the refunds. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; returnId: string }> }) {
  const { id, returnId } = await params;
  return proxyStoreGet(req, id, `returns/${encodeURIComponent(returnId)}`, "[proxy store return]");
}
