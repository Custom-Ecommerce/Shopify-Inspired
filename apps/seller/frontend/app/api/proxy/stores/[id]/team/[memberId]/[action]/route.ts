import { NextRequest } from "next/server";
import { apiError } from "@/lib/proxy";
import { proxyStorePostBody } from "@/lib/store-proxy";
import { isMemberAction } from "@/lib/team-view";

/** POST /api/proxy/stores/:id/team/:memberId/(resend|disable|enable|remove) { revision } (S8-B4). Only those four paths are forwarded. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; memberId: string; action: string }> }) {
  const { id, memberId, action } = await params;
  if (!isMemberAction(action)) return apiError(404, "NOT_FOUND", "Not found.");
  return proxyStorePostBody(req, id, `team/${encodeURIComponent(memberId)}/${action}`, "[proxy store team action]");
}
