import { NextRequest } from "next/server";
import { proxyGet } from "@/lib/proxy";

type Context = { params: Promise<{ id: string }> };

/** GET /api/proxy/media/:id/usage — where a file of the active store is used (products, store settings, later articles, pages, theme). */
export async function GET(req: NextRequest, context: Context) {
  const { id } = await context.params;
  return proxyGet(req, `/api/media/${encodeURIComponent(id)}/usage`, {
    auth: "dashboard",
    storeScope: "required",
    bindStore: false,
    logScope: "[proxy media usage]",
  });
}
