import { NextRequest } from "next/server";
import { proxyPatch } from "@/lib/proxy";

/** Phase 7.5 — PATCH /api/dashboard/reviews/:id: forwards to admin-backend's Reviews PATCH */
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyPatch(req, `/api/reviews/${id}`, {
    auth: "dashboard",
    logScope: "[api/dashboard/reviews/:id]",
  });
}

