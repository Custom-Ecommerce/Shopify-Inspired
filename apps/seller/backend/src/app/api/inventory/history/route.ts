import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { StockHistoryEntry } from '@markaz/contracts';
import { authenticate } from '@/lib/auth';
import { objectIdSchema } from '@/lib/contracts';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { HttpError, handleRouteError, jsonError, parseIntParam } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan, listEnvelope, StockMovement } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface MovementRow {
  _id: unknown;
  variantId: unknown;
  previousQuantity: number;
  delta: number;
  quantity: number;
  reason: string;
  actor?: unknown;
  changedAt: Date;
}

const toEntry = (row: MovementRow): StockHistoryEntry => ({
  id: String(row._id),
  variantId: String(row.variantId),
  previousQuantity: row.previousQuantity,
  delta: row.delta,
  quantity: row.quantity,
  reason: row.reason,
  actor: row.actor ? String(row.actor) : null,
  changedAt: new Date(row.changedAt).toISOString(),
});

/** GET /api/inventory/history?productId=&variantId=&page=&limit=. Newest first, this store's movements only. */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'read', 'inventory');

    const params = request.nextUrl.searchParams;
    const productId = params.get('productId') ?? '';
    const variantId = params.get('variantId') ?? '';
    if (!objectIdSchema.safeParse(productId).success) return jsonError(422, 'productId must be a 24-character ObjectId');
    if (variantId !== '' && !objectIdSchema.safeParse(variantId).success) return jsonError(422, 'variantId must be a 24-character ObjectId');
    const page = parseIntParam(params.get('page'), 1, 1, 100000);
    const limit = parseIntParam(params.get('limit'), 20, 1, 100);

    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const filter: Record<string, unknown> = { store: storeId, product: productId };
    if (variantId !== '') filter.variantId = variantId;

    const [rows, totalDocs] = await Promise.all([
      StockMovement.find(filter)
        .sort({ changedAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean() as unknown as Promise<MovementRow[]>,
      StockMovement.countDocuments(filter),
    ]);

    return NextResponse.json(listEnvelope(rows.map(toEntry), { page, limit, totalDocs }), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
