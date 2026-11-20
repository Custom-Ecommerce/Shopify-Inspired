import { NextRequest } from "next/server";
import { proxyStoreGet } from "@/lib/store-proxy";

/** GET /api/proxy/stores/:id/returns?status=&page=&limit=: the store's returns (Sprint 5 EP-13.US02), paged, with counts per status. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyStoreGet(req, id, "returns", "[proxy store returns]");
}
