import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

/** POST /api/auth/forgot-password { email } (EP-08.US01). Public. The backend always answers the same 200. */
export function POST(req: NextRequest) {
  return proxyPost(req, "/api/auth/forgot-password", { auth: "none", bindStore: false, logScope: "[api/auth/forgot-password]" });
}
