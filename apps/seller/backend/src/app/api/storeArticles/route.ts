import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ARTICLE_STATUSES, ARTICLE_TYPES } from '@/lib/contracts';
import { authenticate } from '@/lib/auth';
import { HttpError, handleRouteError, jsonError, parseIntParam } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan, listEnvelope, StoreArticle } from '@/lib/services';
import { plainDoc, requireSellerStoreId, toWire } from '@/lib/seller-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/storeArticles. The store's articles, newest first, with optional status and type filters. */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'read', 'storeArticles');

    const params = request.nextUrl.searchParams;
    const status = params.get('status');
    const type = params.get('type');
    if (status !== null && !(ARTICLE_STATUSES as readonly string[]).includes(status)) {
      return jsonError(422, 'status must be draft, published, or archived');
    }
    if (type !== null && !(ARTICLE_TYPES as readonly string[]).includes(type)) {
      return jsonError(422, 'type must be blog, lookbook, size_guide, or care_instructions');
    }
    const page = parseIntParam(params.get('page'), 1, 1, 100000);
    const limit = parseIntParam(params.get('limit'), 20, 1, 100);

    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    const storeId = await requireSellerStoreId(ctx);
    const filter: Record<string, unknown> = { store: storeId };
    if (status !== null) filter.status = status;
    if (type !== null) filter.type = type;

    const [rows, totalDocs] = await Promise.all([
      StoreArticle.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      StoreArticle.countDocuments(filter),
    ]);
    const docs = (rows as unknown as Record<string, unknown>[]).map((row) => toWire(plainDoc(row)));
    return NextResponse.json(listEnvelope(docs, { page, limit, totalDocs }), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
