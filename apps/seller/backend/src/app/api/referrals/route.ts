import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { handleRouteError, parseIntParam, HttpError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan, listEnvelope, Referral } from '@/lib/services';
import { plainDoc, requireSellerStoreId, toWire } from '@/lib/seller-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/referrals. The referrals where the seller's store is the referrer, in the list envelope. */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'read', 'referrals');
    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    const storeId = await requireSellerStoreId(ctx);

    const params = request.nextUrl.searchParams;
    const page = parseIntParam(params.get('page'), 1, 1, 100000);
    const limit = parseIntParam(params.get('limit'), 20, 1, 100);
    const filter = { referrer: storeId };

    const [rows, totalDocs] = await Promise.all([
      Referral.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Referral.countDocuments(filter),
    ]);
    const docs = (rows as unknown as Record<string, unknown>[]).map((row) => toWire(plainDoc(row)));
    return NextResponse.json(listEnvelope(docs, { page, limit, totalDocs }), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
