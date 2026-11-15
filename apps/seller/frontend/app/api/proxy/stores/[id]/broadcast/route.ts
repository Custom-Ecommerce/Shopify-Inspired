import { NextRequest } from "next/server";
import { proxyStoreGet, proxyStorePostBody } from "@/lib/store-proxy";

/** GET /api/proxy/stores/:id/broadcast?page&limit: the broadcast history with its outcome counts. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyStoreGet(req, id, "broadcast", "[proxy store broadcast list]");
}

/** POST /api/proxy/stores/:id/broadcast { subject, message, expectedCount }: sends a broadcast (queues the emails). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyStorePostBody(req, id, "broadcast", "[proxy store broadcast]");
}
