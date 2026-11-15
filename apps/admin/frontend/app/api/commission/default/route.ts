import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** GET /api/commission/default: the platform default rate. */
export function GET(request: NextRequest): Promise<Response> {
  return proxyToBackend(request, "/api/admin/commission/default");
}

/** PUT /api/commission/default { rate, reason }. Only those two fields are forwarded. */
export async function PUT(request: NextRequest): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const record = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return proxyToBackend(request, "/api/admin/commission/default", { method: "PUT", body: JSON.stringify({ rate: record.rate, reason: record.reason }) });
}
