import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { archivePlanRequestSchema } from "@/lib/contracts";
import { isObjectId, proxyToBackend } from "@/lib/proxy";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** POST /api/subscription-plans/:id/archive (Sprint 6 EP-14.US01). Only { revision, reason } is forwarded; a plan is never deleted. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  if (!isObjectId(id)) return NextResponse.json({ error: "Plan not found" }, { status: 404, headers: NO_STORE });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400, headers: NO_STORE });
  }
  const input = archivePlanRequestSchema.safeParse(raw);
  if (!input.success) {
    const issues = input.error.issues.map((issue: { path: PropertyKey[]; message: string }) => ({ path: issue.path.map(String).join("."), message: issue.message }));
    return NextResponse.json({ error: "Invalid request", issues }, { status: 422, headers: NO_STORE });
  }
  return proxyToBackend(request, "/api/admin/subscription-plans/" + id + "/archive", { method: "POST", body: JSON.stringify(input.data) });
}
