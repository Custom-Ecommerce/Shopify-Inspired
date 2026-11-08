import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { InventoryProduct } from '@markaz/contracts';
import { productAvailability, variantAvailability } from '@markaz/platform-kit/commerce';
import { authenticate } from '@/lib/auth';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { HttpError, handleRouteError, parseIntParam } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import type { VariantRow } from '@/lib/products';
import { assertCan, listEnvelope, Product } from '@/lib/services';
import { escapeRegex } from '@/lib/storefront/product-query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SEARCH_MAX_LENGTH = 80;

interface InventoryRow {
  _id: unknown;
  title: string;
  isPublished?: boolean | null;
  isDemo?: boolean | null;
  variants: VariantRow[];
}

function toInventoryProduct(row: InventoryRow): InventoryProduct {
  const variants = [...row.variants].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return {
    id: String(row._id),
    title: row.title,
    status: row.isPublished ? 'published' : 'draft',
    isDemo: row.isDemo === true,
    stockStatus: productAvailability(variants.map(variantAvailability)),
    variants: variants.map((variant) => ({
      id: String(variant._id),
      title: variant.title,
      sku: variant.sku ?? null,
      trackQuantity: variant.trackQuantity,
      stockQuantity: variant.stockQuantity,
      lowStockThreshold: variant.lowStockThreshold ?? null,
      availability: variantAvailability(variant),
    })),
  };
}

/** GET /api/inventory?q=&page=&limit=. The store's products with their variants. Trashed products are not inventory. */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'read', 'inventory');
    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const params = request.nextUrl.searchParams;
    const page = parseIntParam(params.get('page'), 1, 1, 100000);
    const limit = parseIntParam(params.get('limit'), 50, 1, 100);
    const q = (params.get('q') ?? '').trim().slice(0, SEARCH_MAX_LENGTH).trim();

    const filter: Record<string, unknown> = { store: storeId, deletedAt: null };
    if (q !== '') filter.title = { $regex: escapeRegex(q), $options: 'i' };

    const [rows, totalDocs] = await Promise.all([
      Product.find(filter)
        .select('title isPublished isDemo variants')
        .sort({ title: 1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean() as unknown as Promise<InventoryRow[]>,
      Product.countDocuments(filter),
    ]);

    return NextResponse.json(listEnvelope(rows.map(toInventoryProduct), { page, limit, totalDocs }), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
