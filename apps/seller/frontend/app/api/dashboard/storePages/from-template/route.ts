import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

/** Sprint 7 (S7-B3): creates ONE default page from its template, as a draft ({ template } only; the backend's body schema is strict, so bindStore is off). */
export function POST(req: NextRequest) {
  return proxyPost(req, "/api/storePages/from-template", { auth: "dashboard", storeScope: "required", bindStore: false, logScope: "[api/dashboard/storePages/from-template]" });
}
