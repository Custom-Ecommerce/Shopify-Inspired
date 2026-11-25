import { NextRequest } from "next/server";
import { proxyGet } from "@/lib/proxy";

/** GET /api/dashboard/subscription/instructions (S6-B4): how to pay, as the admin typed it (plain text; the page escapes it). */
export function GET(req: NextRequest) {
  return proxyGet(req, "/api/subscription/instructions", { auth: "token", logScope: "[api/dashboard/subscription/instructions]" });
}
