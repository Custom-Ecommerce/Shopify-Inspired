import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

/** POST /api/dashboard/subscription/downgrade { planKey | null } (S6-B4): a cheaper plan from the period end, or null to take a pending downgrade back. bindStore is false (strict body). */
export function POST(req: NextRequest) {
  return proxyPost(req, "/api/subscription/downgrade", { auth: "token", bindStore: false, logScope: "[api/dashboard/subscription]" });
}
