import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

/** POST /api/dashboard/alerts/:id/read. `bindStore` is off: the alert is scoped by x-store-id, and there is no body. */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyPost(req, `/api/alerts/${encodeURIComponent(id)}/read`, {
    auth: "dashboard",
    bindStore: false,
    logScope: "[api/dashboard/alerts/:id/read]",
  });
}
