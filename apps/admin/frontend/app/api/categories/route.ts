import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { adminCategoryCreateRequestSchema } from "@/lib/contracts";
import { proxyList, proxyToBackend } from "@/lib/proxy";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** GET /api/categories. A page of platform categories. Only the known query parameters are forwarded. */
export async function GET(request: NextRequest): Promise<Response> {
  return proxyList(request, "/api/admin/categories", ["page", "limit", "q"]);
}

/** POST /api/categories. Creates a category. The body is checked here and again by the backend. */
export async function POST(request: NextRequest): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400, headers: NO_STORE });
  }
  const input = adminCategoryCreateRequestSchema.safeParse(raw);
  if (!input.success) {
    const issues = input.error.issues.map((issue: { path: PropertyKey[]; message: string }) => ({ path: issue.path.map(String).join("."), message: issue.message }));
    return NextResponse.json({ error: "Invalid request", issues }, { status: 422, headers: NO_STORE });
  }
  return proxyToBackend(request, "/api/admin/categories", { method: "POST", body: JSON.stringify(input.data) });
}
