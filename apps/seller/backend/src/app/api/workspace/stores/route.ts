/* patch_session_fix: GET + POST /api/workspace/stores (replaces the placeholder) */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { handleRouteError } from '@/lib/http';
import { loadWorkspace, provisionStore } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The signed-in seller's stores, plus limits. */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    const { stores, limits } = await loadWorkspace(ctx);
    return NextResponse.json({ stores, limits }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** Provisioning endpoint behind the "Create store" form. Body: { name }. */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
    const result = await provisionStore(ctx, body?.name);
    if (!result.ok) return NextResponse.json(result.body, { status: result.status });
    return NextResponse.json({ store: result.store, synced: true }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
