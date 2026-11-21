import { NextRequest } from "next/server";
import { proxyPatch } from "@/lib/proxy";

/** Phase 7.7 — PATCH /api/dashboard/returns/:id: approve/reject/complete a return */
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyPatch(req, `/api/returns/${id}`, {
    auth: "dashboard",
    bindStore: false, // returnStatusUpdateSchema is strict and the store comes from x-store-id: a store in the body is a 400 (SB-6)
    logScope: "[api/dashboard/returns/:id]",
  });
}

