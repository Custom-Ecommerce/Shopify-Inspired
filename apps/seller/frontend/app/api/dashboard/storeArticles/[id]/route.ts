import { NextRequest } from "next/server";
import { proxyGet, proxyPatch, proxyDelete } from "@/lib/proxy";

/** Phase 7.7 — GET (unauthenticated passthrough) / PATCH / DELETE for one article */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyGet(req, `/api/storeArticles/${id}`, {
    auth: "none",
    params: { depth: 1 },
    logScope: "[api/dashboard/storeArticles/:id]",
  });
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyPatch(req, `/api/storeArticles/${id}`, {
    auth: "dashboard",
    logScope: "[api/dashboard/storeArticles/:id]",
  });
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyDelete(req, `/api/storeArticles/${id}`, {
    auth: "dashboard",
    logScope: "[api/dashboard/storeArticles/:id]",
  });
}

