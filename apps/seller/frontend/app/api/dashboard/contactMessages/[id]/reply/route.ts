import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

type Context = { params: Promise<{ id: string }> };

/**
 * POST /api/dashboard/contactMessages/:id/reply { revision, text } (Sprint 7, S7-B4): answers a message. By email when the shopper gave one; otherwise the
 * answer carries `whatsappLink`. `bindStore` is off (strict body).
 */
export async function POST(req: NextRequest, context: Context) {
  const { id } = await context.params;
  return proxyPost(req, `/api/contactMessages/${encodeURIComponent(id)}/reply`, { auth: "dashboard", storeScope: "required", bindStore: false, logScope: "[api/dashboard/contactMessages]" });
}
