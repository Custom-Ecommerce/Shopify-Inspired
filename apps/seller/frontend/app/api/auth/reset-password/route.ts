import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

/** POST /api/auth/reset-password { token, password } (EP-08.US01). Public: the token is the proof. */
export function POST(req: NextRequest) {
  return proxyPost(req, "/api/auth/reset-password", { auth: "none", bindStore: false, logScope: "[api/auth/reset-password]" });
}
