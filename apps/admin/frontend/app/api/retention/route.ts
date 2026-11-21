import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { retentionRunRequestSchema } from "@/lib/contracts";
import { proxyToBackend } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** POST /api/retention { apply? } (S6-B7): a dry run unless apply is true. Owner level only (the backend enforces it). */
export async function POST(request: NextRequest): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const parsed = retentionRunRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
    return NextResponse.json({ error: issues[0]?.message ?? "Check the details and try again.", issues }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }
  return proxyToBackend(request, "/api/admin/retention", { method: "POST", body: JSON.stringify(parsed.data) });
}
