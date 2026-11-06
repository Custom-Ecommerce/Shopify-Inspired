import { NextRequest } from "next/server";
import { proxyGet } from "@/lib/proxy";

/**
 * Phase 7.4 — GET /api/dashboard/orders/:id
 *
 * Auth-required passthrough (Orders are NOT publicly readable, unlike
 * Products) — forwards the seller's cookie JWT; admin-backend's own
 * `Orders.access.read` (`adminOrOwnStore("store")`) is what actually
 * rejects a seller viewing another store's order.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyGet(req, `/api/orders/${id}`, {
    auth: "dashboard",
    logScope: "[api/dashboard/orders/:id]",
    params: { depth: 0 },
  });
}
