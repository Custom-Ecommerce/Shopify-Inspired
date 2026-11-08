import { NextRequest } from "next/server";
import { proxyGet, proxyPatch, proxyDelete } from "@/lib/proxy";

/**
 * Phase 7.4 — GET/PATCH/DELETE /api/dashboard/products/:id
 *
 * All three need the seller's session: drafts are private, and the backend
 * answers 404 for a product of another store. `bindStore` is off because the
 * product contract refuses a `store` in the body; the store is `x-store-id`.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyGet(req, `/api/products/${id}`, {
    auth: "dashboard",
    logScope: "[api/dashboard/products/:id]",
  });
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyPatch(req, `/api/products/${id}`, {
    auth: "dashboard",
    bindStore: false,
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
