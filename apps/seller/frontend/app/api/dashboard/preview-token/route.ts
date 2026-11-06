import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

/** POST /api/dashboard/preview-token. The store is the verified active store, never one from the browser's body. */
export async function POST(req: NextRequest) {
  return proxyPost(req, "/api/preview-token", {
    auth: "dashboard",
    bindStore: false,
    logScope: "[api/dashboard/preview-token]",
  });
}
