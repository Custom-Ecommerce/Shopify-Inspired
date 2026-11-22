import { NextRequest } from "next/server";
import { proxyDelete, proxyPatch } from "@/lib/proxy";

type Context = { params: Promise<{ id: string }> };

/**
 * PATCH  /api/proxy/media/:id — renames a file of the active store (body: { name }). Nothing but the name changes; the address of the file stays.
 * DELETE /api/proxy/media/:id — deletes it. A file that is still used answers 409 `MEDIA_IN_USE`, with where it is used in `details`.
 *
 * `bindStore` is off for both: the backend's body schema is strict ({ name } only), so a `store` field added by the proxy would be refused with a 400.
 * The store comes from `x-store-id`, which the proxy verifies against the seller's stores.
 */
export async function PATCH(req: NextRequest, context: Context) {
  const { id } = await context.params;
  return proxyPatch(req, `/api/media/${encodeURIComponent(id)}`, {
    auth: "dashboard",
    storeScope: "required",
    bindStore: false,
    logScope: "[proxy media]",
  });
}

export async function DELETE(req: NextRequest, context: Context) {
  const { id } = await context.params;
  return proxyDelete(req, `/api/media/${encodeURIComponent(id)}`, {
    auth: "dashboard",
    storeScope: "required",
    bindStore: false,
    logScope: "[proxy media]",
  });
}
