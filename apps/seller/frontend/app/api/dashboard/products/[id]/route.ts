import { NextRequest } from "next/server";
import { proxyGet, proxyPatch, proxyDelete } from "@/lib/proxy";

/**
 * Phase 7.4 — GET/PATCH/DELETE /api/dashboard/products/:id
 *
 * GET is a plain passthrough (no auth check) — Products are publicly
 * readable anyway (`Products.access.read = anyone`); this exists only so
 * `/dashboard/products/[id]/page.tsx`, a client component, has an
 * own-origin route to load the product it's editing.
 */
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyGet(_req, `/api/products/${id}`, {
    auth: "none",
    logScope: "[api/dashboard/products/:id]",
    params: { depth: 1 },
  });
}

/**
 * Phase 7.4 — PATCH/DELETE /api/dashboard/products/:id
 *
 * Forwards the seller's JWT cookie; admin-backend's own
 * `Products.access.update`/`delete` (`adminOrOwnStore("store")`)
 * enforces ownership server-side.
 */
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyPatch(req, `/api/products/${id}`, {
    auth: "dashboard",
    logScope: "[api/dashboard/products/:id]",
  });
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyDelete(req, `/api/products/${id}`, {
    auth: "dashboard",
    logScope: "[api/dashboard/products/:id]",
  });
}
