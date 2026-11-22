import { NextRequest } from "next/server";
import { proxyDelete, proxyGet, proxyPatch } from "@/lib/proxy";

type Context = { params: Promise<{ id: string }> };

/** Sprint 7 (S7-B3): one page of the active store. PATCH carries the `revision` the form read; `bindStore` is off on every call (the backend's PATCH body is strict). */
export async function GET(req: NextRequest, context: Context) {
  const { id } = await context.params;
  return proxyGet(req, `/api/storePages/${encodeURIComponent(id)}`, { auth: "dashboard", storeScope: "required", bindStore: false, logScope: "[api/dashboard/storePages/:id]" });
}

export async function PATCH(req: NextRequest, context: Context) {
  const { id } = await context.params;
  return proxyPatch(req, `/api/storePages/${encodeURIComponent(id)}`, { auth: "dashboard", storeScope: "required", bindStore: false, logScope: "[api/dashboard/storePages/:id]" });
}

export async function DELETE(req: NextRequest, context: Context) {
  const { id } = await context.params;
  return proxyDelete(req, `/api/storePages/${encodeURIComponent(id)}`, { auth: "dashboard", storeScope: "required", bindStore: false, logScope: "[api/dashboard/storePages/:id]" });
}
