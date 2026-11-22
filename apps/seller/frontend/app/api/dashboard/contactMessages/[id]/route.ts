import { NextRequest } from "next/server";
import { proxyGet, proxyPatch } from "@/lib/proxy";

type Context = { params: Promise<{ id: string }> };

/**
 * GET   /api/dashboard/contactMessages/:id: one message of the active store.
 * PATCH /api/dashboard/contactMessages/:id { revision, status: "read" | "closed" }: marks it read or closes it.
 *
 * `bindStore` is off: the backend's body schema is strict ({ revision, status } only), so a `store` field added by the proxy would be a 400.
 */
export async function GET(req: NextRequest, context: Context) {
  const { id } = await context.params;
  return proxyGet(req, `/api/contactMessages/${encodeURIComponent(id)}`, { auth: "dashboard", storeScope: "required", bindStore: false, logScope: "[api/dashboard/contactMessages]" });
}

export async function PATCH(req: NextRequest, context: Context) {
  const { id } = await context.params;
  return proxyPatch(req, `/api/contactMessages/${encodeURIComponent(id)}`, { auth: "dashboard", storeScope: "required", bindStore: false, logScope: "[api/dashboard/contactMessages]" });
}
