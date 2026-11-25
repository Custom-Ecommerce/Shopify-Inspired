import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

/** POST /api/dashboard/subscription/cancel { cancelAtPeriodEnd } (S6-B4): stops the subscription at the period end, or takes that back. bindStore is false (strict body). */
export function POST(req: NextRequest) {
  return proxyPost(req, "/api/subscription/cancel", { auth: "token", bindStore: false, logScope: "[api/dashboard/subscription]" });
}
