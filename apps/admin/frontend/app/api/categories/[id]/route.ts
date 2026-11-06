import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { adminCategoryUpdateRequestSchema } from "@/lib/contracts";
import { isObjectId, proxyToBackend } from "@/lib/proxy";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

type Context = { params: Promise<{ id: string }> };

/** PATCH /api/categories/:id. Changes the fields sent. The body is checked here and again by the backend. */
export async function PATCH(request: NextRequest, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isObjectId(id)) return NextResponse.json({ error: "Category not found" }, { status: 404, headers: NO_STORE });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400, headers: NO_STORE });
  }
  const input = adminCategoryUpdateRequestSchema.safeParse(raw);
  if (!input.success) {
    const issues = input.error.issues.map((issue: { path: PropertyKey[]; message: string }) => ({ path: issue.path.map(String).join("."), message: issue.message }));
    return NextResponse.json({ error: "Invalid request", issues }, { status: 422, headers: NO_STORE });
  }
  return proxyToBackend(request, "/api/admin/categories/" + id, { method: "PATCH", body: JSON.stringify(input.data) });
}

/** DELETE /api/categories/:id. Removes a category. */
export async function DELETE(request: NextRequest, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isObjectId(id)) return NextResponse.json({ error: "Category not found" }, { status: 404, headers: NO_STORE });
  return proxyToBackend(request, "/api/admin/categories/" + id, { method: "DELETE" });
}
