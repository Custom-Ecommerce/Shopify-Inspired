import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

/** POST /api/dashboard/products/:id/publish. The refusal codes come back as they are. */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyPost(req, `/api/products/${id}/publish`, {
    auth: "dashboard",
    bindStore: false,
    logScope: "[api/dashboard/products/:id/publish]",
  });
}
