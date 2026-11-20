import { NextRequest } from "next/server";
import { proxyGet } from "@/lib/proxy";

/** GET /api/dashboard/alerts?page=&limit= (EP-07.US03): the active store's alerts, forwarded to the seller backend's GET /api/alerts. */
export async function GET(req: NextRequest) {
  return proxyGet(req, "/api/alerts", { auth: "dashboard", logScope: "[api/dashboard/alerts]" });
}
