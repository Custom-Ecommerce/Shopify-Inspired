import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { HttpError, handleRouteError, jsonError, parseIntParam } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan, listEnvelope, Return } from '@/lib/services';
import { plainDoc, toWire } from '@/lib/seller-scope';
import { resolveOwnedStoreId } from '@/lib/data-plane';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RETURN_STATUSES = ['requested', 'approved', 'rejected', 'completed'];

async function requireDatabase(): Promise<void> {
  await connectSellerDb().catch(() => {
    throw new HttpError(503, 'Seller database unavailable');
  });
}

/** GET /api/returns. The store's returns, newest first, with an optional status filter. */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'read', 'returns');

    const params = request.nextUrl.searchParams;
    const status = params.get('status');
    if (status !== null && !RETURN_STATUSES.includes(status)) {
      return jsonError(422, 'status must be requested, approved, rejected, or completed');
    }
    const page = parseIntParam(params.get('page'), 1, 1, 100000);
    const limit = parseIntParam(params.get('limit'), 20, 1, 100);

    await requireDatabase();
    const storeId = await resolveOwnedStoreId(request, ctx, null);
    const filter: Record<string, unknown> = { store: storeId };
    if (status !== null) filter.status = status;

    const [rows, totalDocs] = await Promise.all([
      Return.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Return.countDocuments(filter),
    ]);
    const docs = (rows as unknown as Record<string, unknown>[]).map((row) => toWire(plainDoc(row)));
    return NextResponse.json(listEnvelope(docs, { page, limit, totalDocs }), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
