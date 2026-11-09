import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createDiscountSchema } from '@/lib/contracts';
import { authenticate } from '@/lib/auth';
import { HttpError, handleRouteError, isDuplicateKeyError, parseIntParam } from '@/lib/http';
import { parseBody } from '@/lib/placeholder';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan, Discount, listEnvelope } from '@/lib/services';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { plainDoc, toWire } from '@/lib/seller-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireDatabase(): Promise<void> {
  await connectSellerDb().catch(() => {
    throw new HttpError(503, 'Seller database unavailable');
  });
}

/** GET /api/discounts?archived=true. The active store's codes, newest first, in the list envelope. Archived ones are listed apart. */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'read', 'discounts');
    await requireDatabase();
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const params = request.nextUrl.searchParams;
    const page = parseIntParam(params.get('page'), 1, 1, 100000);
    const limit = parseIntParam(params.get('limit'), 20, 1, 100);
    const filter = { store: storeId, archivedAt: params.get('archived') === 'true' ? { $ne: null } : null };

    const [rows, totalDocs] = await Promise.all([
      Discount.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Discount.countDocuments(filter),
    ]);
    const docs = (rows as unknown as Record<string, unknown>[]).map((row) => toWire(plainDoc(row)));
    return NextResponse.json(listEnvelope(docs, { page, limit, totalDocs }), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/discounts. Creates a discount for the seller's store and answers 201. */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    const body = await parseBody(request, createDiscountSchema);
    if (!body.ok) return body.response;
    assertCan(ctx.actor, 'create', 'discounts', Object.keys(body.data));
    await requireDatabase();
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    try {
      const created = await Discount.create({
        ...body.data,
        store: storeId,
        usedCount: 0,
      });
      return NextResponse.json(toWire(plainDoc(created)), { status: 201 });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw new HttpError(409, 'A discount with this code already exists');
      throw err;
    }
  } catch (err) {
    return handleRouteError(err);
  }
}
