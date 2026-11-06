import * as previewNs from '@markaz/platform-kit/preview';
import { unwrapCjs } from '@/lib/cjs';
import { HttpError } from '@/lib/http';

// The kit re-exports through CommonJS. Read it through the default object, as lib/preview-token.ts does.
const { PREVIEW_QUERY_PARAM } = unwrapCjs(previewNs) as typeof previewNs;

/**
 * The address of a store on the storefront, with a preview token on it. A store lives on `<slug>.<root>`, where root is the
 * storefront's own host (apps/storefront/middleware.ts, ROOT_DOMAIN), so STOREFRONT_URL gives both the scheme and the root.
 * Locally that is `<slug>.localhost:3000`. Without a usable STOREFRONT_URL there is nowhere to send the seller: a 503.
 */
export function storePreviewUrl(storefrontUrl: string | undefined, slug: string, token: string): string {
  let root: URL;
  try {
    root = new URL(storefrontUrl ?? '');
  } catch {
    throw new HttpError(503, 'Preview is not configured');
  }
  const host = root.host.replace(/^www\./, '');
  return `${root.protocol}//${slug}.${host}/?${PREVIEW_QUERY_PARAM}=${encodeURIComponent(token)}`;
}
