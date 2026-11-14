import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";
import { tokenToCookie } from "@/lib/session-cookie";

/** POST /api/account/password { currentPassword, newPassword } (EP-08.US04). This session's fresh token goes into the cookie. */
export function POST(req: NextRequest) {
  return proxyPost(req, "/api/users/me/password", { auth: "token", bindStore: false, responseHandler: tokenToCookie, logScope: "[api/account/password]" });
}
