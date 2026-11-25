import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

/** POST /api/dashboard/subscription/payments/claim { paymentId, method, reference, proofUrl? } (S6-B4): "I paid". bindStore is false: the backend's body is strict and a store id in it is refused. */
export function POST(req: NextRequest) {
  return proxyPost(req, "/api/subscription/payments/claim", { auth: "token", bindStore: false, logScope: "[api/dashboard/subscription]" });
}
