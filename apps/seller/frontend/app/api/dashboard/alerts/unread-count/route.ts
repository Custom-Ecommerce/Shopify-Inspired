import { NextRequest } from "next/server";
import { proxyGet } from "@/lib/proxy";

/** GET /api/dashboard/alerts/unread-count: { unread } for the active store. The header bell polls it every 60 seconds. */
export async function GET(req: NextRequest) {
  return proxyGet(req, "/api/alerts/unread-count", { auth: "dashboard", logScope: "[api/dashboard/alerts/unread-count]" });
}
