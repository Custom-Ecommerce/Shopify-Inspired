import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

/** POST /api/dashboard/alerts/read-all. `bindStore` is off: the alerts are scoped by x-store-id, and there is no body. */
export async function POST(req: NextRequest) {
  return proxyPost(req, "/api/alerts/read-all", { auth: "dashboard", bindStore: false, logScope: "[api/dashboard/alerts/read-all]" });
}
