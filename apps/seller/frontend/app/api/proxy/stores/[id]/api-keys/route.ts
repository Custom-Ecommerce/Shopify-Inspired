import { NextRequest } from "next/server";
import { proxyStoreGet, proxyStorePostBody } from "@/lib/store-proxy";

/** GET /api/proxy/stores/:id/api-keys: the store's keys (never a secret or a hash) and the plan usage (S8-B4). Owner only, checked by the backend. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyStoreGet(req, id, "api-keys", "[proxy store api keys]");
}

/** POST /api/proxy/stores/:id/api-keys { name, scopes }: the answer holds the full secret once. Strict backend body: nothing is bound. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyStorePostBody(req, id, "api-keys", "[proxy store api key create]");
}
