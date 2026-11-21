import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

/** Sprint 5 EP-21.US02 — POST /api/dashboard/reviews/:id/reply { reply }: the seller's first reply to a review. The backend validates it. */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyPost(req, `/api/reviews/${id}/reply`, {
    auth: "dashboard",
    bindStore: false, // the backend schema is strict and takes the store from x-store-id: a store in the body is a 400 (SB-6)
    logScope: "[api/dashboard/reviews/:id/reply]",
  });
}
