import { PREVIEW_CACHE_CONTROL, clearedPreviewCookie } from "@markaz/storefront-data/preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/storefront/preview/exit: drops the preview cookie and returns to the live store's home page, on this host. */
export function POST(): Response {
  return new Response(null, {
    status: 303,
    headers: {
      location: "/",
      "cache-control": PREVIEW_CACHE_CONTROL,
      "set-cookie": clearedPreviewCookie(process.env.NODE_ENV === "production"),
    },
  });
}
