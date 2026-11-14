import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

/** POST /api/auth/resend-verification (signed in; EP-08.US02). The dashboard banner's "Send the link again". */
export function POST(req: NextRequest) {
  return proxyPost(req, "/api/auth/resend-verification", { auth: "token", bindStore: false, logScope: "[api/auth/resend-verification]" });
}
