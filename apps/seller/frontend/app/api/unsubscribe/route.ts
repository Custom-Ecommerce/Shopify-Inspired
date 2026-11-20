import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

/** POST /api/unsubscribe { store, email, sig } (EP-07.US04). Public: the customer who opens the link has no session. */
export function POST(req: NextRequest) {
  return proxyPost(req, "/api/unsubscribe", { auth: "none", bindStore: false, logScope: "[api/unsubscribe]" });
}
