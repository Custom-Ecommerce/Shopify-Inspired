import { NextRequest } from "next/server";
import { proxyGet, proxyPost } from "@/lib/proxy";

/**
 * Sprint 7 (S7-B2, CO-116): the blog's list and create, store-scoped through the verified x-store-id.
 *
 * `bindStore` is off for the create: the backend's body schema is strict (title, slug, excerpt, content, coverImage, status, tags and the SEO fields), so a
 * `store` field added by the proxy would be a 400. The store comes from the header, which the proxy checks against the seller's stores. The list passes
 * `status`, `q`, `page` and `limit` through; the store keys of a client are stripped by the proxy.
 */
export function GET(req: NextRequest) {
  return proxyGet(req, "/api/storeArticles", {
    auth: "dashboard",
    storeScope: "required",
    bindStore: false,
    logScope: "[api/dashboard/storeArticles]",
  });
}

export function POST(req: NextRequest) {
  return proxyPost(req, "/api/storeArticles", {
    auth: "dashboard",
    storeScope: "required",
    bindStore: false,
    logScope: "[api/dashboard/storeArticles]",
  });
}
