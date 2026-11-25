import { NextRequest } from "next/server";
import { proxyStorePost } from "@/lib/store-proxy";

/** POST /api/proxy/stores/:id/api-keys/:keyId/revoke (S8-B4): no body from the browser is forwarded. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; keyId: string }> }) {
  const { id, keyId } = await params;
  return proxyStorePost(req, id, `api-keys/${encodeURIComponent(keyId)}/revoke`, "[proxy store api key revoke]");
}
