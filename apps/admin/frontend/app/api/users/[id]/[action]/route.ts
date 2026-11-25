import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { changeLevelRequestSchema, setAdminStatusRequestSchema } from "@/lib/contracts";
import { isObjectId, proxyToBackend } from "@/lib/proxy";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** POST /api/users/:id/level { adminLevel, reason } | /disable { reason } | /enable { reason }. The body is checked against the shared strict contract; the backend decides. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string; action: string }> }): Promise<Response> {
  const { id, action } = await context.params;
  if (!isObjectId(id) || !["level", "disable", "enable"].includes(action)) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400, headers: NO_STORE });
  }
  const parsed = (action === "level" ? changeLevelRequestSchema : setAdminStatusRequestSchema).safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the details and try again.", issues: parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })) }, { status: 422, headers: NO_STORE });
  return proxyToBackend(request, "/api/admin/users/" + id + "/" + action, { method: "POST", body: JSON.stringify(parsed.data) });
}
