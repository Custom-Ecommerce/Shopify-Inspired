import { NextRequest } from "next/server";
import { proxyStorePostBody } from "@/lib/store-proxy";

/** POST /api/proxy/stores/:id/broadcast/preview { subject, message }: the number of customers who would receive it. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyStorePostBody(req, id, "broadcast/preview", "[proxy store broadcast preview]");
}
