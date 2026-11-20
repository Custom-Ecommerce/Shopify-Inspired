import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

/** POST /api/auth/verify-email { token } (EP-08.US02, US04). Public: works with or without a session. */
export function POST(req: NextRequest) {
  return proxyPost(req, "/api/auth/verify-email", { auth: "none", bindStore: false, logScope: "[api/auth/verify-email]" });
}
