import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

/** POST /api/dashboard/products/import. Multipart: file and dryRun. The seller backend parses, checks and writes. */
export function POST(req: NextRequest) {
  return proxyPost(req, "/api/products/import", {
    auth: "dashboard",
    bindStore: false,
    logScope: "[api/dashboard/products/import]",
  });
}
