import { NextRequest } from "next/server";
import { proxyStoreGet, proxyStorePostBody } from "@/lib/store-proxy";

/** GET /api/proxy/stores/:id/blocklist: the phones and emails this store refuses orders from (Sprint 5 EP-11.US02). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyStoreGet(req, id, "blocklist", "[proxy store blocklist]");
}

/** POST /api/proxy/stores/:id/blocklist { kind, value, reason? }: adds one contact. The backend validates every field. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyStorePostBody(req, id, "blocklist", "[proxy store blocklist add]");
}
