import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import {
  categoryError,
  categorySlugFromName,
  nextCategoryOrder,
  resolveCategoryStoreId,
  slugTaken,
} from '@/lib/categories';
import { categoryCreateRequestSchema } from '@/lib/contracts';
import { HttpError, handleRouteError, isDuplicateKeyError, parseIntParam } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { parseBody } from '@/lib/placeholder';
import { revalidateStoreCategories } from '@/lib/revalidate';
import { assertCan, Category, listEnvelope } from '@/lib/services';
import { plainDoc, toWire } from '@/lib/seller-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireDatabase(): Promise<void> {
  await connectSellerDb().catch(() => {
    throw new HttpError(503, 'Seller database unavailable');
  });
}

/** GET /api/categories. The store's categories, by order then name, in the list envelope. */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'read', 'categories');
    await requireDatabase();
    const storeId = await resolveCategoryStoreId(request, ctx);

    const params = request.nextUrl.searchParams;
    const page = parseIntParam(params.get('page'), 1, 1, 100000);
    const limit = parseIntParam(params.get('limit'), 50, 1, 200);
    const filter = { store: storeId };

    const [rows, totalDocs] = await Promise.all([
      Category.find(filter).sort({ order: 1, name: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      Category.countDocuments(filter),
    ]);
    const docs = (rows as unknown as Record<string, unknown>[]).map((row) => toWire(plainDoc(row)));
    return NextResponse.json(listEnvelope(docs, { page, limit, totalDocs }), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * POST /api/categories. Creates a category in the seller's store and answers 201. A missing slug is made from the
 * name; a clash inside the store is a 409 CATEGORY_SLUG_TAKEN. The unique (store, slug) index decides, so two racing
 * requests cannot both win.
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    const body = await parseBody(request, categoryCreateRequestSchema);
    if (!body.ok) return body.response;
    assertCan(ctx.actor, 'create', 'categories', Object.keys(body.data));
    await requireDatabase();
    const storeId = await resolveCategoryStoreId(request, ctx);

    const slug = body.data.slug ?? categorySlugFromName(body.data.name);
    if (slug === '') {
      return categoryError(422, 'CATEGORY_SLUG_REQUIRED', 'This name cannot be turned into a slug. Enter one yourself.');
    }

    try {
      const created = await Category.create({
        ...body.data,
        slug,
        order: body.data.order ?? (await nextCategoryOrder(storeId)),
        store: storeId,
      });
      await revalidateStoreCategories(storeId);
      return NextResponse.json(toWire(plainDoc(created)), { status: 201 });
    } catch (err) {
      if (isDuplicateKeyError(err)) return slugTaken();
      throw err;
    }
  } catch (err) {
    return handleRouteError(err);
  }
}
