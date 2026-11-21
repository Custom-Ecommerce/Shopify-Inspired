import { NextRequest } from "next/server";
import { proxyStoreGet } from "@/lib/store-proxy";

/** GET /api/proxy/stores/:id/abandoned-carts?status=&page=&limit=: the carts shoppers left in this store (Sprint 5 EP-28.US01), with the open count. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyStoreGet(req, id, "abandoned-carts", "[proxy store abandoned carts]");
}
