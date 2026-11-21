import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

/** POST /api/dashboard/subscription/payments { planKey } (S6-B4): asks to upgrade or renew. The amount is the plan's price: the backend's body is strict, so nothing is added to it (bindStore false). */
export function POST(req: NextRequest) {
  return proxyPost(req, "/api/subscription/payments", { auth: "token", bindStore: false, logScope: "[api/dashboard/subscription]" });
}
