import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createPlanRequestSchema } from "@/lib/contracts";
import { proxyList, proxyToBackend } from "@/lib/proxy";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** GET /api/subscription-plans. A page of subscription plans with the tier counts. Only the known query parameters are forwarded. */
export async function GET(request: NextRequest): Promise<Response> {
  return proxyList(request, "/api/admin/subscription-plans", ["page", "limit", "q", "tier"]);
}

/**
 * POST /api/subscription-plans (Sprint 6 EP-14.US01). Creates a plan. The body is checked here with the shared contract (whole rupees, limits, key,
 * features, a reason) and again by the backend; only the checked fields are forwarded.
 */
export async function POST(request: NextRequest): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400, headers: NO_STORE });
  }
  const input = createPlanRequestSchema.safeParse(raw);
  if (!input.success) {
    const issues = input.error.issues.map((issue: { path: PropertyKey[]; message: string }) => ({ path: issue.path.map(String).join("."), message: issue.message }));
    return NextResponse.json({ error: "Invalid request", issues }, { status: 422, headers: NO_STORE });
  }
  return proxyToBackend(request, "/api/admin/subscription-plans", { method: "POST", body: JSON.stringify(input.data) });
}
