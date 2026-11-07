import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

/** POST /api/dashboard/products/:id/duplicate. The answer is the new draft. */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyPost(req, `/api/products/${id}/duplicate`, {
    auth: "dashboard",
    bindStore: false,
    logScope: "[api/dashboard/products/:id/duplicate]",
  });
}
