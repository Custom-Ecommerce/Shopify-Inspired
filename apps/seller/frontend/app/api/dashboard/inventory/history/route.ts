import { NextRequest } from "next/server";
import { proxyGet } from "@/lib/proxy";

/** GET /api/dashboard/inventory/history?productId=&variantId=&page=. */
export async function GET(req: NextRequest) {
  return proxyGet(req, "/api/inventory/history", { auth: "dashboard", logScope: "[api/dashboard/inventory/history]" });
}
