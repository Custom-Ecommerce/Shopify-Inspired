import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { confirmPaymentBodySchema, decidePaymentBodySchema } from "@/lib/contracts";
import { isObjectId, proxyToBackend } from "@/lib/proxy";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const ACTIONS = ["confirm", "reject", "void"] as const;

/**
 * POST /api/subscription-payments/:id/confirm { amountRs, reason } | /reject { reason } | /void { reason } (Sprint 6 EP-14, S6-B4, D-118). The body
 * is checked here against the shared contract (a strict object: only the known keys are ever forwarded), and again by the admin backend and the
 * seller backend, which own the rules, the compare-and-set and the audit entry. The payment id is the path's; the operator is the session's.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string; action: string }> }): Promise<Response> {
  const { id, action } = await context.params;
  if (!isObjectId(id) || !(ACTIONS as readonly string[]).includes(action)) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400, headers: NO_STORE });
  }
  const schema = action === "confirm" ? confirmPaymentBodySchema : decidePaymentBodySchema;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message }));
    return NextResponse.json({ error: issues[0]?.message ?? "Check the details and try again.", issues }, { status: 422, headers: NO_STORE });
  }
  return proxyToBackend(request, "/api/admin/subscription-payments/" + id + "/" + action, { method: "POST", body: JSON.stringify(parsed.data) });
}
