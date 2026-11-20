import { NextRequest } from "next/server";
import { proxyStoreGet } from "@/lib/store-proxy";

/** GET /api/proxy/stores/:id/customers?page&limit&phone=1&q&sort&repeat&hasEmail&unsubscribed: the store's customers (derived from its orders), paged. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyStoreGet(req, id, "customers", "[proxy store customers]");
}
