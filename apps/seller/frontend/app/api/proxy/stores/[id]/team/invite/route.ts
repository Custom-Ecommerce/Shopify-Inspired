import { NextRequest } from "next/server";
import { proxyStorePostBody } from "@/lib/store-proxy";

/** POST /api/proxy/stores/:id/team/invite { email, role } (S8-B4). The backend schema is strict, so no body.store is added (bindStore:false in the helper). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyStorePostBody(req, id, "team/invite", "[proxy store team invite]");
}
