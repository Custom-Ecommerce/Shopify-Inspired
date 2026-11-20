import { NextRequest } from "next/server";
import { proxyGet, proxyPatch } from "@/lib/proxy";

/** GET /api/account/me: the signed-in seller's own account (name, email, phone, pending email, verified). */
export function GET(req: NextRequest) {
  return proxyGet(req, "/api/users/me", { auth: "token", logScope: "[api/account/me]" });
}

/** PATCH /api/account/me { name?, phone? } (EP-08.US04). */
export function PATCH(req: NextRequest) {
  return proxyPatch(req, "/api/users/me", { auth: "token", bindStore: false, logScope: "[api/account/me]" });
}
