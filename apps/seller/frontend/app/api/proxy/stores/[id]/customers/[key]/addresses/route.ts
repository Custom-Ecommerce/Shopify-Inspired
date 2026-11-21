import { NextRequest } from "next/server";
import { proxyStoreGet } from "@/lib/store-proxy";

/** GET /api/proxy/stores/:id/customers/:key/addresses: the customer's address book, seller side only (Sprint 5 EP-10.US03). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; key: string }> }) {
  const { id, key } = await params;
  return proxyStoreGet(req, id, `customers/${encodeURIComponent(key)}/addresses`, "[proxy store customer addresses]");
}
