import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { retryRequestSchema } from "@/lib/contracts";
import { proxyToBackend } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** POST /api/notifications/retry { ids } (S6-B7): failed emails back to queued, 1 to 100 ids. */
export async function POST(request: NextRequest): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const parsed = retryRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
    return NextResponse.json({ error: issues[0]?.message ?? "Check the details and try again.", issues }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }
  return proxyToBackend(request, "/api/admin/notifications/retry", { method: "POST", body: JSON.stringify(parsed.data) });
}
