import { NextRequest } from "next/server";
import { proxyGet } from "@/lib/proxy";

/**
 * Phase 7.4 — GET /api/dashboard/orders/:id/label
 *
 * Proxies to admin-backend's `GET /api/orders/:id/label`, forwarding the seller's
 * cookie JWT and streaming the PDF bytes straight through.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyGet(req, `/api/orders/${id}/label`, {
    auth: "dashboard",
    logScope: "[api/dashboard/orders/:id/label]",
  });
}

