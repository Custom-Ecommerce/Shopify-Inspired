import { NextRequest } from "next/server";
import { proxyGet } from "@/lib/proxy";

/** GET /api/dashboard/inventory. The store's products with their variants and derived stock status. */
export async function GET(req: NextRequest) {
  return proxyGet(req, "/api/inventory", { auth: "dashboard", logScope: "[api/dashboard/inventory]" });
}
