import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { storefrontCategoryListResponseSchema } from '@/lib/contracts';
import { PUBLIC_CATEGORY_READABLE_FIELDS, Category, Product, assertCan } from '@/lib/services';
import { PUBLIC_CACHE_HEADERS } from '@/lib/storefront/errors';
import { liveListFilter, previewListFilter } from '@/lib/storefront/live-product';
import { PREVIEW_RESPONSE_HEADERS, isPreviewRequest, storefrontFailure } from '@/lib/storefront/preview-request';
import { loadActiveStore } from '@/lib/storefront/store-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A category as .lean() returns it after populating its banner. */
interface CategoryRow {
  _id: unknown;
  name: string;
  slug: string;
  order?: number | null;
  description?: string | null;
  banner?: { url?: string | null } | null;
}

function toStorefrontCategory(row: CategoryRow) {
  return {
    id: String(row._id),
    name: row.name,
    slug: row.slug,
    order: row.order ?? 0,
    description: row.description ?? null,
    bannerUrl: row.banner?.url ?? null,
  };
}

/**
 * GET /api/storefront/v1/stores/:id/categories
 *
 * Public: no session. The categories of one active store that hold at least one published product, by order then name.
 * An empty category is left out, so a shopper is never sent to an empty page and a draft stays undiscoverable. A seller's
 * preview lists every category holding a product the preview shows, and also works on a pending store.
 *
 *   404 STORE_NOT_FOUND   malformed or unknown store id
 *   403 STORE_NOT_ACTIVE  the store exists but is not serving (the body carries its status)
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  let preview = false;
  try {
    const { id } = await context.params;
    preview = await isPreviewRequest(request, id);
    assertCan('public', 'read', 'categories', PUBLIC_CATEGORY_READABLE_FIELDS);
    await loadActiveStore(id, { preview });

    const held = await Product.distinct('categories', preview ? previewListFilter(id) : liveListFilter(id));
    const rows = (await Category.find({ store: id, _id: { $in: held } })
      .select('name slug order description banner')
      .sort({ order: 1, name: 1 })
      .populate({ path: 'banner', select: 'url' })
      .lean()) as unknown as CategoryRow[];

    const body = storefrontCategoryListResponseSchema.parse({ data: rows.map(toStorefrontCategory) });
    return NextResponse.json(body, { headers: preview ? PREVIEW_RESPONSE_HEADERS : PUBLIC_CACHE_HEADERS });
  } catch (err) {
    return storefrontFailure(err, preview);
  }
}
