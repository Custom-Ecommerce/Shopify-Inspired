import { NextRequest } from "next/server";
import { proxyGet } from "@/lib/proxy";

/** GET /api/dashboard/referrals (S8-B5): the signed-in owner's referral code, share link and referrals. The backend takes no parameters. */
export function GET(req: NextRequest) {
  return proxyGet(req, "/api/referrals", {
    auth: "dashboard",
    storeScope: "required",
    logScope: "[api/dashboard/referrals]",
  });
}

