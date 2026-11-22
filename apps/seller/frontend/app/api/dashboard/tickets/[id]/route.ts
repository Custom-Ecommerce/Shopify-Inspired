import { NextRequest } from "next/server";
import { proxyGet } from "@/lib/proxy";

type Context = { params: Promise<{ id: string }> };

/** GET /api/dashboard/tickets/:id: one of the seller's own tickets with its messages. Someone else's ticket is a 404 from the backend. */
export async function GET(req: NextRequest, context: Context) {
  const { id } = await context.params;
  return proxyGet(req, `/api/tickets/${encodeURIComponent(id)}`, { auth: "dashboard", storeScope: "optional", bindStore: false, logScope: "[api/dashboard/tickets]" });
}
