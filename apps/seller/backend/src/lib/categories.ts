import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { AuthContext } from '@/lib/auth';
import { CATEGORY_ORDER_MAX, CATEGORY_SLUG_MAX } from '@/lib/contracts';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { Category, Product } from '@/lib/services';

/** Machine-readable reasons for a refused category write. The dashboard reads them through the proxy. */
export type CategoryErrorCode = 'CATEGORY_IN_USE' | 'CATEGORY_SLUG_TAKEN' | 'CATEGORY_SLUG_REQUIRED';

/** The route error envelope with a code added: { errors: [{ message, code }] }. */
export function categoryError(
  status: number,
  code: CategoryErrorCode,
  message: string,
  extra: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json({ errors: [{ message, code, ...extra }] }, { status });
}

export const slugTaken = (): NextResponse =>
  categoryError(409, 'CATEGORY_SLUG_TAKEN', 'A category with this slug already exists in this store');

/**
 * The store a category request is about, verified against the signed-in seller. A seller may own several stores, so
 * the dashboard's x-store-id decides, then a ?storeId= query, then the seller's first store. A store the seller does
 * not own is refused with 403. A store named in the body is never read: the request contracts refuse the field.
 */
export async function resolveCategoryStoreId(request: NextRequest, ctx: AuthContext): Promise<string> {
  const requested = request.nextUrl.searchParams.get('storeId')?.trim();
  return resolveOwnedStoreId(request, ctx, requested ? { store: { equals: requested } } : null);
}

/** A slug from a category name, or '' when the name holds no Latin letter or digit, as in an Urdu name. */
export function categorySlugFromName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, CATEGORY_SLUG_MAX)
    .replace(/-+$/g, '');
}

/** The order that puts a new category after the store's last one. */
export async function nextCategoryOrder(storeId: string): Promise<number> {
  const last = await Category.findOne({ store: storeId }).sort({ order: -1 }).select('order').lean();
  return Math.min((last?.order ?? -1) + 1, CATEGORY_ORDER_MAX);
}

/**
 * How many products of this store still use a category. The flat Product model has no deletion marker yet, so every
 * product counts; once products can sit in trash, decide here whether a trashed product still holds its category.
 */
export function countProductsInCategory(storeId: string, categoryId: string): Promise<number> {
  return Product.countDocuments({ store: storeId, categories: categoryId });
}
