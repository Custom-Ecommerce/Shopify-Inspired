import { NextRequest } from "next/server";
import { proxyStorePatchBody } from "@/lib/store-proxy";

/** PATCH /api/proxy/stores/:id/customers/:key/note { note?, tags? }: the seller's private note and tags on a customer. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; key: string }> }) {
  const { id, key } = await params;
  return proxyStorePatchBody(req, id, `customers/${encodeURIComponent(key)}/note`, "[proxy store customer note]");
}
