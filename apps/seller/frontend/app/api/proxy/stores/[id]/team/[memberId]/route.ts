import { NextRequest } from "next/server";
import { proxyStorePatchBody } from "@/lib/store-proxy";

/** PATCH /api/proxy/stores/:id/team/:memberId { role, revision } (S8-B4): a role change. Strict backend body: nothing is bound. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  const { id, memberId } = await params;
  return proxyStorePatchBody(req, id, `team/${encodeURIComponent(memberId)}`, "[proxy store team role]");
}
