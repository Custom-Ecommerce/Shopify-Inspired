import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

/**
 * Phase 7.4 — POST /api/dashboard/orders/:id/status
 *
 * Proxies to admin-backend's `POST /api/orders/:id/status` (Phase 7.2's
 * `orderStatus.ts` — auth, ownership, transition validation, courier
 * booking, and the whatsappNotificationUrl all live there; this route
 * forwards the JWT and the response, nothing more, same as every other
 * dashboard proxy).
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyPost(req, `/api/orders/${id}/status`, {
    auth: "dashboard",
    bindStore: false, // custom endpoint, not a store-owned collection write
    logScope: "[api/dashboard/orders/:id/status]",
  });
}
