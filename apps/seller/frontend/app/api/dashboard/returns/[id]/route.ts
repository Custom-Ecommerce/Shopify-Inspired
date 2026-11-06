import { NextRequest } from "next/server";
import { proxyPatch } from "@/lib/proxy";

/** Phase 7.7 — PATCH /api/dashboard/returns/:id: approve/reject/complete a return */
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyPatch(req, `/api/returns/${id}`, {
    auth: "dashboard",
    logScope: "[api/dashboard/returns/:id]",
  });
}

