import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  moderationDeleteRequestSchema,
  moderationPermanentDeleteRequestSchema,
  moderationRestoreRequestSchema,
  moderationTakedownRequestSchema,
} from "@/lib/contracts";
import { proxyToBackend } from "@/lib/proxy";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

const SCHEMAS = {
  takedown: moderationTakedownRequestSchema,
  restore: moderationRestoreRequestSchema,
  delete: moderationDeleteRequestSchema,
  "permanent-delete": moderationPermanentDeleteRequestSchema,
};

function isAction(value: string): value is keyof typeof SCHEMAS {
  return Object.prototype.hasOwnProperty.call(SCHEMAS, value);
}

/** POST /api/products/:action. A moderation action. The body is checked here and again by the seller backend. */
export async function POST(request: NextRequest, context: { params: Promise<{ action: string }> }): Promise<Response> {
  const { action } = await context.params;
  if (!isAction(action)) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400, headers: NO_STORE });
  }
  const input = SCHEMAS[action].safeParse(raw);
  if (!input.success) {
    const issues = input.error.issues.map((issue: { path: PropertyKey[]; message: string }) => ({ path: issue.path.map(String).join("."), message: issue.message }));
    return NextResponse.json({ error: issues[0]?.message ?? "Invalid request", issues }, { status: 422, headers: NO_STORE });
  }
  return proxyToBackend(request, "/api/admin/products/" + action, { method: "POST", body: JSON.stringify(input.data) });
}
