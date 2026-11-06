import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { adminSettingsUpdateRequestSchema } from "@/lib/contracts";
import { proxyToBackend } from "@/lib/proxy";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** GET /api/settings. The platform settings. No query parameter is forwarded. */
export async function GET(request: NextRequest): Promise<Response> {
  return proxyToBackend(request, "/api/admin/settings");
}

/** PATCH /api/settings. Changes the settings sent. The body is checked here and again by the backend. */
export async function PATCH(request: NextRequest): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400, headers: NO_STORE });
  }
  const input = adminSettingsUpdateRequestSchema.safeParse(raw);
  if (!input.success) {
    const issues = input.error.issues.map((issue: { path: PropertyKey[]; message: string }) => ({ path: issue.path.map(String).join("."), message: issue.message }));
    return NextResponse.json({ error: "Invalid request", issues }, { status: 422, headers: NO_STORE });
  }
  return proxyToBackend(request, "/api/admin/settings", { method: "PATCH", body: JSON.stringify(input.data) });
}
