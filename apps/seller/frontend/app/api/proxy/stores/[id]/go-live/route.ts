import { NextRequest } from "next/server";
import { proxyStorePost } from "@/lib/store-proxy";

/** POST /api/proxy/stores/:id/go-live: a 422 STORE_NOT_READY keeps its { missing, items } for the checklist. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyStorePost(req, id, "go-live", "[proxy store go-live]");
}
