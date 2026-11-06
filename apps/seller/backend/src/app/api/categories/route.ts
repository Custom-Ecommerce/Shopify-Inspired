import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { HttpError, handleRouteError, parseIntParam } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan, Category, listEnvelope } from '@/lib/services';
import { plainDoc, toWire } from '@/lib/seller-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/categories. The platform's categories, by order then name, in the list envelope. Read-only for sellers. */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'read', 'categories');

    const params = request.nextUrl.searchParams;
    const page = parseIntParam(params.get('page'), 1, 1, 100000);
    const limit = parseIntParam(params.get('limit'), 50, 1, 200);

    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });

    const [rows, totalDocs] = await Promise.all([
      Category.find({}).sort({ order: 1, name: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      Category.countDocuments({}),
    ]);
    const docs = (rows as unknown as Record<string, unknown>[]).map((row) => toWire(plainDoc(row)));
    return NextResponse.json(listEnvelope(docs, { page, limit, totalDocs }), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
