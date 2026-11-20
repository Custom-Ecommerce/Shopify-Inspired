import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";
import { tokenToCookie } from "@/lib/session-cookie";

/** POST /api/account/sessions/revoke-others (EP-08.US04). Other devices are signed out; this one keeps a fresh cookie. */
export function POST(req: NextRequest) {
  return proxyPost(req, "/api/users/me/sessions/revoke-others", { auth: "token", bindStore: false, responseHandler: tokenToCookie, logScope: "[api/account/revoke-others]" });
}
