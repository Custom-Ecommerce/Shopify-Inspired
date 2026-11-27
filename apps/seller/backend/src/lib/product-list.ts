import type { ProductListSort, ProductListStatus } from '@markaz/contracts';
import { PRODUCT_LIST_SORTS, PRODUCT_LIST_STATUSES } from '@/lib/contracts';
import { HttpError, parseIntParam } from '@/lib/http';
import type { SellerProductRow } from '@/lib/products';
import { Product } from '@/lib/services';
import { escapeRegex } from '@/lib/storefront/product-query';

/*
 * The seller's product list, shared by GET /api/products and the phone's list. The query rules were the route's own; Sprint 9 moved them here unchanged,
 * with the page size cap as the only thing a caller chooses.
 */

const SEARCH_MAX_LENGTH = 80;
/** The overview's "low stock" count: a tracked variant at or below this many units. */
export const LOW_STOCK_UNITS = 5;

export const lowStockCondition = (): Record<string, unknown> => ({ $elemMatch: { trackQuantity: true, stockQuantity: { $lte: LOW_STOCK_UNITS } } });

/** Only what a list row needs. media is cut to its first entry. */
const LIST_PROJECTION = {
  title: 1,
  slug: 1,
  isPublished: 1,
  isDemo: 1,
  isFeatured: 1,
  hideWhenOutOfStock: 1,
  deletedAt: 1,
  deletedBy: 1,
  moderation: 1,
  description: 1,
  highlights: 1,
  minPrice: 1,
  'variants.price': 1,
  'variants.compareAtPrice': 1,
  'variants.trackQuantity': 1,
  'variants.stockQuantity': 1,
  'variants.lowStockThreshold': 1,
  'variants.position': 1,
  categories: 1,
  media: { $slice: 1 },
  createdAt: 1,
  updatedAt: 1,
};

const SORT_SPECS: Record<ProductListSort, Record<string, 1 | -1>> = {
  newest: { createdAt: -1, _id: -1 },
  oldest: { createdAt: 1, _id: 1 },
  title: { title: 1, _id: 1 },
  price: { minPrice: 1, _id: 1 },
};

function oneOf<T extends string>(raw: string | null, allowed: readonly T[], fallback: T, name: string): T {
  const value = (raw ?? '').trim();
  if (value === '') return fallback;
  if (!(allowed as readonly string[]).includes(value)) throw new HttpError(422, name + ' must be one of: ' + allowed.join(', '));
  return value as T;
}

export interface ProductListPage {
  rows: SellerProductRow[];
  totalDocs: number;
  page: number;
  limit: number;
}

/** ?q=&status=&sort=&stock=&page=&limit= for one store. A bad status, sort or stock is a 422. */
export async function readProductListPage(storeId: string, params: URLSearchParams, caps: { defaultLimit: number; maxLimit: number }): Promise<ProductListPage> {
  const page = parseIntParam(params.get('page'), 1, 1, 100000);
  const limit = parseIntParam(params.get('limit'), caps.defaultLimit, 1, caps.maxLimit);
  const status = oneOf<ProductListStatus>(params.get('status'), PRODUCT_LIST_STATUSES, 'all', 'status');
  const sort = oneOf<ProductListSort>(params.get('sort'), PRODUCT_LIST_SORTS, 'newest', 'sort');
  const stock = oneOf(params.get('stock'), ['any', 'low'] as const, 'any', 'stock');
  const q = (params.get('q') ?? '').trim().slice(0, SEARCH_MAX_LENGTH).trim();

  // $type, not $ne: null. The trash index is partial on $type, and a query only uses it when it matches that condition.
  const filter: Record<string, unknown> = { store: storeId, deletedAt: status === 'trash' ? { $type: 'date' } : null };
  if (status === 'draft' || status === 'published') filter.isPublished = status === 'published';
  if (q !== '') filter.title = { $regex: escapeRegex(q), $options: 'i' };
  if (stock === 'low') filter.variants = lowStockCondition();

  const [rows, totalDocs] = await Promise.all([
    Product.find(filter)
      .select(LIST_PROJECTION)
      .sort(SORT_SPECS[sort])
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({ path: 'categories', select: 'name slug' })
      .populate({ path: 'media', select: 'url alt' })
      .lean() as unknown as Promise<SellerProductRow[]>,
    Product.countDocuments(filter),
  ]);
  return { rows, totalDocs, page, limit };
}
