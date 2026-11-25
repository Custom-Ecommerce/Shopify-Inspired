import { NextRequest } from "next/server";
import { proxyGet } from "@/lib/proxy";

/**
 * GET /api/team/invite?token=... (S8-B2, D-118): what the accept page may show to a person holding a valid invite token (the store, the role, the invited email). Public:
 * the invitee may have no account yet. Anything but a valid token is { valid: false }.
 */
export function GET(req: NextRequest) {
  return proxyGet(req, "/api/team/invite", { auth: "none", logScope: "[api/team/invite]" });
}
