import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

/**
 * POST /api/team/accept { token } (S8-B2, D-118): the signed-in user accepts an invitation to a store's team. It needs a session ("token": the cookie is forwarded) but NO
 * active store: the invite names the store, so there is no store to resolve and none to bind. bindStore:false because the backend schema is strict ({ token } only): a
 * body.store added here would be a 400 (SB-6).
 */
export function POST(req: NextRequest) {
  return proxyPost(req, "/api/team/accept", { auth: "token", bindStore: false, logScope: "[api/team/accept]" });
}
