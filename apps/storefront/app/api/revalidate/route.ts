import { revalidateTag } from "next/cache";
import { handleRevalidateRequest } from "@markaz/platform-kit/revalidate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cache-purge endpoint called by the seller backend. The secret travels in the x-revalidate-secret header only. */
export function POST(request: Request): Promise<Response> {
  return handleRevalidateRequest(request, { secret: process.env.REVALIDATE_SECRET, purge: (tag) => revalidateTag(tag) });
}
