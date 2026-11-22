import { NextRequest } from "next/server";
import { proxyDelete, proxyGet, proxyPatch } from "@/lib/proxy";

type Context = { params: Promise<{ id: string }> };

/**
 * Sprint 7 (S7-B2, CO-116): one article of the active store. GET reads it (it was an unauthenticated passthrough before, which the backend refused), PATCH
 * saves it with the `revision` the form read, DELETE removes it. `bindStore` is off on every call: the backend's PATCH body is strict, so a `store` field
 * added by the proxy would be a 400; the store comes from x-store-id.
 */
export async function GET(req: NextRequest, context: Context) {
  const { id } = await context.params;
  return proxyGet(req, `/api/storeArticles/${encodeURIComponent(id)}`, {
    auth: "dashboard",
    storeScope: "required",
    bindStore: false,
    logScope: "[api/dashboard/storeArticles/:id]",
  });
}

export async function PATCH(req: NextRequest, context: Context) {
  const { id } = await context.params;
  return proxyPatch(req, `/api/storeArticles/${encodeURIComponent(id)}`, {
    auth: "dashboard",
    storeScope: "required",
    bindStore: false,
    logScope: "[api/dashboard/storeArticles/:id]",
  });
}

export async function DELETE(req: NextRequest, context: Context) {
  const { id } = await context.params;
  return proxyDelete(req, `/api/storeArticles/${encodeURIComponent(id)}`, {
    auth: "dashboard",
    storeScope: "required",
    bindStore: false,
    logScope: "[api/dashboard/storeArticles/:id]",
  });
}
