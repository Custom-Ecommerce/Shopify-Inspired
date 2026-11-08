import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

/** POST /api/dashboard/products/:id/restore. The product comes back as a draft. */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyPost(req, `/api/products/${id}/restore`, {
    auth: "dashboard",
    bindStore: false,
    logScope: "[api/dashboard/products/:id/restore]",
  });
}
