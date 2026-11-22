import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isObjectId, proxyToBackend } from "@/lib/proxy";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const ACTIONS = ["reply", "status"] as const;
const STATUSES = ["open", "answered", "closed"];

/**
 * POST /api/tickets/:id/reply { revision, text } | /status { revision, status } (Sprint 7, S7-B4). Only the known keys are ever forwarded (the body is rebuilt
 * here); the admin backend checks the capability (tickets.reply), validates again, writes the audit entry, and the seller backend owns the compare-and-set.
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
  const body = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const revision = body.revision;
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) return NextResponse.json({ error: "Reload the ticket: its version is missing." }, { status: 400, headers: NO_STORE });
  if (action === "reply") {
    if (typeof body.text !== "string" || body.text.trim() === "" || body.text.length > 3000) return NextResponse.json({ error: "Write a reply of 1 to 3000 characters." }, { status: 400, headers: NO_STORE });
    return proxyToBackend(request, "/api/admin/tickets/" + id + "/reply", { method: "POST", body: JSON.stringify({ revision, text: body.text }) });
  }
  if (typeof body.status !== "string" || !STATUSES.includes(body.status)) return NextResponse.json({ error: "Choose open, answered or closed." }, { status: 400, headers: NO_STORE });
  return proxyToBackend(request, "/api/admin/tickets/" + id + "/status", { method: "POST", body: JSON.stringify({ revision, status: body.status }) });
}
