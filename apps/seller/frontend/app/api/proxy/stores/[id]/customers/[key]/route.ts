import { NextRequest } from "next/server";
import { proxyStoreGet } from "@/lib/store-proxy";

/** GET /api/proxy/stores/:id/customers/:key: one customer (statistics, note and tags, orders, addresses). :key is a phone (+923...) or an email. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; key: string }> }) {
  const { id, key } = await params;
  return proxyStoreGet(req, id, `customers/${encodeURIComponent(key)}`, "[proxy store customer]");
}
