import { NextRequest } from "next/server";
import { proxyPatch } from "@/lib/proxy";

/** Phase 7.6 — PATCH /api/dashboard/discounts/:id (e.g. toggling isActive). Ownership enforced by admin-backend's own Discounts.access.update (adminOrOwnStore), same "proxy forwards" pattern as every other dashboard proxy. */
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyPatch(req, `/api/discounts/${id}`, {
    auth: "dashboard",
    bindStore: false, // updateDiscountSchema is strict and the store comes from x-store-id: a store in the body is a 400 (SB-6)
    logScope: "[api/dashboard/discounts/:id]",
  });
}
