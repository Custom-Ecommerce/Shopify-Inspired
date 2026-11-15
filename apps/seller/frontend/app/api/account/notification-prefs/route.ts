import { NextRequest } from "next/server";
import { proxyGet, proxyPatch } from "@/lib/proxy";

/** GET /api/account/notification-prefs: { prefs: { emailNewOrder, emailLowStock } } (EP-07.US03.T03). */
export function GET(req: NextRequest) {
  return proxyGet(req, "/api/users/me/notification-prefs", { auth: "token", logScope: "[api/account/notification-prefs]" });
}

/** PATCH /api/account/notification-prefs { emailNewOrder?, emailLowStock? }; a 400 keeps its field. */
export function PATCH(req: NextRequest) {
  return proxyPatch(req, "/api/users/me/notification-prefs", { auth: "token", bindStore: false, logScope: "[api/account/notification-prefs]" });
}
