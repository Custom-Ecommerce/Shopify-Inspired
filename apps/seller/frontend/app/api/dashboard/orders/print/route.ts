import { NextRequest, NextResponse } from "next/server";
import { proxyGet } from "@/lib/proxy";

/**
 * GET /api/dashboard/orders/print?ids=<id>,<id>,... (EP-02 OB-5b)
 *
 * Forwards the query string, the seller's session and the active store header to the seller backend's GET /api/orders/print.
 * The answer holds customers' phones and addresses, so the no-store the backend sets is repeated here: the proxy does not
 * pass upstream headers on by itself.
 */
export async function GET(req: NextRequest) {
  return proxyGet(req, "/api/orders/print", {
    auth: "dashboard",
    bindStore: false,
    logScope: "[api/dashboard/orders/print]",
    responseHandler: (_res, data) => NextResponse.json(data, { headers: { "Cache-Control": "no-store" } }),
  });
}
