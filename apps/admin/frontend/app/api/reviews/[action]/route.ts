import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/proxy";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const REASON_MIN = 3;
const REASON_MAX = 300;

/**
 * POST /api/reviews/hide { reviewId, reason } and POST /api/reviews/unhide { reviewId } (Sprint 5 EP-21.US01.T05). Only these keys are forwarded; the
 * body is checked here and again by the admin backend and the seller backend, which owns the rules.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ action: string }> }): Promise<Response> {
  const { action } = await context.params;
  if (action !== "hide" && action !== "unhide") return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });

  let raw: { reviewId?: unknown; reason?: unknown } | null;
  try {
    raw = (await request.json()) as { reviewId?: unknown; reason?: unknown } | null;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400, headers: NO_STORE });
  }
  const reviewId = raw?.reviewId;
  if (typeof reviewId !== "string" || !OBJECT_ID.test(reviewId)) {
    return NextResponse.json({ error: "reviewId must be a 24-character ObjectId" }, { status: 422, headers: NO_STORE });
  }
  if (action === "unhide") return proxyToBackend(request, "/api/admin/reviews/unhide", { method: "POST", body: JSON.stringify({ reviewId }) });

  const reason = typeof raw?.reason === "string" ? raw.reason.trim() : "";
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
    return NextResponse.json({ error: "Give a reason of " + REASON_MIN + " to " + REASON_MAX + " characters." }, { status: 422, headers: NO_STORE });
  }
  return proxyToBackend(request, "/api/admin/reviews/hide", { method: "POST", body: JSON.stringify({ reviewId, reason }) });
}
