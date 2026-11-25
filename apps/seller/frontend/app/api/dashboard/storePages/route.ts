import { NextRequest } from "next/server";
import { proxyGet, proxyPost } from "@/lib/proxy";

/**
 * Sprint 7 (S7-B3): the pages manager's list and create, store-scoped through the verified x-store-id. GET also carries the catalogue of default page templates;
 * reading it creates nothing. `bindStore` is off for the create: the backend's body schema is strict, so a `store` field added by the proxy would be a 400.
 */
export function GET(req: NextRequest) {
  return proxyGet(req, "/api/storePages", { auth: "dashboard", storeScope: "required", bindStore: false, logScope: "[api/dashboard/storePages]" });
}

export function POST(req: NextRequest) {
  return proxyPost(req, "/api/storePages", { auth: "dashboard", storeScope: "required", bindStore: false, logScope: "[api/dashboard/storePages]" });
}
