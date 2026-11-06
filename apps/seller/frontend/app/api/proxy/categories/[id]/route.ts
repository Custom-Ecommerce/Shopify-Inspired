import { NextRequest } from "next/server";
import { proxyDelete, proxyPatch } from "@/lib/proxy";

type Context = { params: Promise<{ id: string }> };

/**
 * PATCH  /api/proxy/categories/:id — edits a category of the active store.
 * DELETE /api/proxy/categories/:id — deletes it. A category that holds products answers 409 `CATEGORY_IN_USE`.
 *
 * `bindStore` is off for the reason given on the collection route: the store comes from `x-store-id`.
 */
export async function PATCH(req: NextRequest, context: Context) {
  const { id } = await context.params;
  return proxyPatch(req, `/api/categories/${encodeURIComponent(id)}`, {
    auth: "dashboard",
    storeScope: "required",
    bindStore: false,
    logScope: "[proxy categories]",
  });
}

export async function DELETE(req: NextRequest, context: Context) {
  const { id } = await context.params;
  return proxyDelete(req, `/api/categories/${encodeURIComponent(id)}`, {
    auth: "dashboard",
    storeScope: "required",
    bindStore: false,
    logScope: "[proxy categories]",
  });
}
