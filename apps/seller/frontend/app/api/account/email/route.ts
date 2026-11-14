import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

/** POST /api/account/email { password, newEmail } (EP-08.US04). The link goes to the new address. */
export function POST(req: NextRequest) {
  return proxyPost(req, "/api/users/me/email", { auth: "token", bindStore: false, logScope: "[api/account/email]" });
}
