import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { inviteAdminRequestSchema } from "@/lib/contracts";
import { proxyToBackend } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** GET /api/users: the admin accounts. POST /api/users { name, email, adminLevel }: invite one. Owner level only; the backend enforces it. */
export function GET(request: NextRequest): Promise<Response> {
  return proxyToBackend(request, "/api/admin/users");
}

export async function POST(request: NextRequest): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const parsed = inviteAdminRequestSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the details and try again.", issues: parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })) }, { status: 422, headers: { "Cache-Control": "no-store" } });
  return proxyToBackend(request, "/api/admin/users", { method: "POST", body: JSON.stringify(parsed.data) });
}
