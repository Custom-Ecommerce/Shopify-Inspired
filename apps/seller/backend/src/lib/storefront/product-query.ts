import {
  STOREFRONT_CATEGORY_SLUG_PATTERN,
  STOREFRONT_PRODUCTS_DEFAULT_LIMIT,
  STOREFRONT_PRODUCTS_MAX_LIMIT,
  STOREFRONT_PRODUCTS_MAX_PAGE,
  STOREFRONT_PRODUCT_SORTS,
  STOREFRONT_SEARCH_MAX_LENGTH,
} from '@/lib/contracts';
import { parseIntParam } from '@/lib/http';
import { StorefrontHttpError } from '@/lib/storefront/errors';

export type ProductSort = 'newest' | 'price_asc' | 'price_desc' | 'rating';

export interface ProductListQuery {
  category: string | null;
  q: string | null;
  sort: ProductSort;
  page: number;
  limit: number;
}

const SORT_SPECS: Record<ProductSort, Record<string, 1 | -1>> = {
  newest: { createdAt: -1, _id: -1 },
  price_asc: { minPrice: 1, _id: 1 },
  price_desc: { minPrice: -1, _id: -1 },
  rating: { avgRating: -1, reviewCount: -1, _id: -1 },
};

export function sortSpec(sort: ProductSort): Record<string, 1 | -1> {
  return SORT_SPECS[sort];
}

const REGEX_SPECIAL = '.*+?^$' + '{}()|[]\\';

/** Escapes user text for use inside a $regex, one character at a time. */
export function escapeRegex(value: string): string {
  let out = '';
  for (const ch of value) out += REGEX_SPECIAL.includes(ch) ? '\\' + ch : ch;
  return out;
}

/**
 * Reads and bounds the list params.
 * - limit is clamped to 1..48 (default 24); page to 1..1000 (default 1). Numeric abuse is clamped, not rejected.
 * - q is trimmed and cut to 80 characters.
 * - sort and category are enumerated or pattern-checked; a bad value is a 400 rather than a silent fallback.
 */
export function parseProductListQuery(params: URLSearchParams): ProductListQuery {
  const limit = parseIntParam(params.get('limit'), STOREFRONT_PRODUCTS_DEFAULT_LIMIT, 1, STOREFRONT_PRODUCTS_MAX_LIMIT);
  const page = parseIntParam(params.get('page'), 1, 1, STOREFRONT_PRODUCTS_MAX_PAGE);

  const rawSort = (params.get('sort') ?? '').trim();
  let sort: ProductSort = 'newest';
  if (rawSort !== '') {
    if (!(STOREFRONT_PRODUCT_SORTS as readonly string[]).includes(rawSort)) {
      throw new StorefrontHttpError(400, 'INVALID_REQUEST', 'sort must be one of: ' + STOREFRONT_PRODUCT_SORTS.join(', '));
    }
    sort = rawSort as ProductSort;
  }

  const rawCategory = (params.get('category') ?? '').trim().toLowerCase();
  if (rawCategory !== '' && !STOREFRONT_CATEGORY_SLUG_PATTERN.test(rawCategory)) {
    throw new StorefrontHttpError(400, 'INVALID_REQUEST', 'category is not a valid slug');
  }

  const rawQ = (params.get('q') ?? '').trim().slice(0, STOREFRONT_SEARCH_MAX_LENGTH).trim();

  return { category: rawCategory === '' ? null : rawCategory, q: rawQ === '' ? null : rawQ, sort, page, limit };
}
