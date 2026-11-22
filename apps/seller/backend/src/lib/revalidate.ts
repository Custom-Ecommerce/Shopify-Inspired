import { after } from 'next/server';
import { unwrapCjs } from '@/lib/cjs';
import { Product, Store } from '@/lib/services';
import * as revalidateNs from '@markaz/platform-kit/revalidate';

// The kit re-exports through CommonJS. Read it through the default object, as lib/contracts.ts does.
const { buildRevalidateRequest, domainResolveTag, isAllowedRevalidateTag, storeResolveTag, storeTags } = unwrapCjs(revalidateNs) as typeof revalidateNs;

const REVALIDATE_TIMEOUT_MS = 3000;

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : 'unknown');

const purgeSettings = (): { storefrontUrl: string; secret: string } | null => {
  const storefrontUrl = process.env.STOREFRONT_URL ?? '';
  const secret = process.env.REVALIDATE_SECRET ?? '';
  return storefrontUrl === '' || secret === '' ? null : { storefrontUrl, secret };
};

/** Tells the storefront to drop these tags. A failure is logged. The secret travels in a header and is never logged. */
async function notifyStorefront(settings: { storefrontUrl: string; secret: string }, tags: string[]): Promise<void> {
  const built = buildRevalidateRequest({ ...settings, tags });
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
    console.error('[seller-backend] storefront revalidation failed', { tags, message: messageOf(err) });
  }
}

const running = new Set<Promise<void>>();

/**
 * Runs a purge after the response has gone out, so a seller's save or a customer's order never waits for the storefront
 * and cannot fail because of it. With STOREFRONT_URL or REVALIDATE_SECRET unset it does nothing, and the cache then
 * expires on its own.
 */
function inBackground(purge: (settings: { storefrontUrl: string; secret: string }) => Promise<void>): void {
  const settings = purgeSettings();
  if (settings === null) return;
  const run = (): Promise<void> => {
    const work: Promise<void> = purge(settings)
      .catch((err: unknown) => console.error('[seller-backend] storefront revalidation failed', { message: messageOf(err) }))
      .finally(() => running.delete(work));
    running.add(work);
    return work;
  };
  try {
    after(run);
  } catch {
    // Not inside a request: a script or a test.
    void run();
  }
}

/** Test hook: resolves when every purge started so far has finished. */
export async function settleRevalidations(): Promise<void> {
  await Promise.all(running);
}

/** The product's slug, which is what the storefront tags its product page with. Null when the product is gone. */
async function slugOf(productId: string): Promise<string | null> {
  try {
    const row = (await Product.findById(productId).select('slug').lean()) as unknown as { slug?: unknown } | null;
    return typeof row?.slug === 'string' ? row.slug : null;
  } catch (err) {
    console.error('[seller-backend] could not read a product for revalidation', { productId, message: messageOf(err) });
    return null;
  }
}

/**
 * After a product changes in a way a shopper can see, stock reaching or leaving zero included. The category list follows
 * too: it shows only categories that hold a published product. A product that no longer exists has no page tag of its
 * own, and its page goes with the list tag.
 */
export function revalidateStoreProduct(storeId: string, productId: string): void {
  inBackground(async (settings) => {
    const slug = await slugOf(productId);
    const tags = [storeTags.products(storeId), storeTags.categories(storeId)];
    await notifyStorefront(settings, slug === null ? tags : [storeTags.product(storeId, slug), ...tags]);
  });
}

/** After a category write. Product summaries carry category names, so they follow too. */
export function revalidateStoreCategories(storeId: string): void {
  inBackground((settings) => notifyStorefront(settings, [storeTags.categories(storeId), storeTags.products(storeId)]));
}

/**
 * After a change to the store itself: settings, branding, delivery rate, theme or status. Its record is cached by key.
 *
 * S7-B6: the record is also cached by the store's custom domain (`domain-resolve:<host>`), so that tag is purged too: the store's CURRENT domain
 * (whatever its status: a negative answer for a host that has just been verified is cached as well), and every host in `options.domains` (the old
 * domain when it changed, the domain that was just disconnected, which the store no longer holds).
 */
export function revalidateStore(storeId: string, options: { domains?: ReadonlyArray<string | null | undefined> } = {}): void {
  inBackground(async (settings) => {
    const tags = [storeTags.settings(storeId), storeTags.static(storeId)];
    const hosts = new Set<string>();
    for (const host of options.domains ?? []) if (typeof host === 'string' && host !== '') hosts.add(host.toLowerCase());
    try {
      const row = (await Store.findById(storeId).select('slug internalHandle domain').lean()) as unknown as { slug?: unknown; internalHandle?: unknown; domain?: unknown } | null;
      for (const key of [row?.slug, row?.internalHandle]) {
        if (typeof key === 'string' && isAllowedRevalidateTag(storeResolveTag(key.toLowerCase()))) tags.push(storeResolveTag(key.toLowerCase()));
      }
      if (typeof row?.domain === 'string' && row.domain !== '') hosts.add(row.domain.toLowerCase());
    } catch (err) {
      console.error('[seller-backend] could not read a store for revalidation', { storeId, message: messageOf(err) });
    }
    for (const host of hosts) if (isAllowedRevalidateTag(domainResolveTag(host))) tags.push(domainResolveTag(host));
    await notifyStorefront(settings, tags);
  });
}
