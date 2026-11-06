import { unwrapCjs } from '@/lib/cjs';
import * as revalidateNs from '@markaz/platform-kit/revalidate';

// The kit re-exports through CommonJS. Read it through the default object, as lib/contracts.ts does.
const { buildRevalidateRequest, storeTags } = unwrapCjs(revalidateNs) as typeof revalidateNs;

const REVALIDATE_TIMEOUT_MS = 3000;

/**
 * Tells the storefront to drop its cached copies. Best effort: with STOREFRONT_URL or REVALIDATE_SECRET unset it does
 * nothing, and a failure is logged, never thrown, so a seller's write cannot fail because the storefront is down. The
 * cache then expires on its own. The secret travels in a header and is never logged.
 */
async function notifyStorefront(tags: string[]): Promise<void> {
  const storefrontUrl = process.env.STOREFRONT_URL ?? '';
  const secret = process.env.REVALIDATE_SECRET ?? '';
  if (storefrontUrl === '' || secret === '') return;

  const built = buildRevalidateRequest({ storefrontUrl, secret, tags });
  if (!built.ok) {
    console.error('[seller-backend] storefront revalidation not sent', { reason: built.reason });
    return;
  }

  try {
    const response = await fetch(built.request.url, {
      ...built.request.init,
      signal: AbortSignal.timeout(REVALIDATE_TIMEOUT_MS),
    });
    if (!response.ok) console.error('[seller-backend] storefront revalidation refused', { status: response.status, tags });
  } catch (err) {
    console.error('[seller-backend] storefront revalidation failed', { tags, message: err instanceof Error ? err.message : 'unknown' });
  }
}

/** After a product write. The category list follows too: it shows only categories that hold a published product. */
export function revalidateStoreProduct(storeId: string, productId: string): Promise<void> {
  return notifyStorefront([storeTags.products(storeId), storeTags.product(storeId, productId), storeTags.categories(storeId)]);
}

/** After a category write. Product summaries carry category names, so they follow too. */
export function revalidateStoreCategories(storeId: string): Promise<void> {
  return notifyStorefront([storeTags.categories(storeId), storeTags.products(storeId)]);
}
