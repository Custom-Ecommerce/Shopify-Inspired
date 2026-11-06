import type { NextRequest } from 'next/server';
import type { NextResponse } from 'next/server';
import * as previewNs from '@markaz/platform-kit/preview';
import { unwrapCjs } from '@/lib/cjs';
import { readPreviewLink } from '@/lib/preview-token';
import { handleStorefrontError } from '@/lib/storefront/errors';

// The kit re-exports through CommonJS. Read it through the default object, as lib/preview-token.ts does.
const { PREVIEW_CREDENTIAL_HEADER } = unwrapCjs(previewNs) as typeof previewNs;

/** Every response made for a preview. Nothing may keep one, and nothing may answer a live request with one. */
export const PREVIEW_RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store',
  Vary: PREVIEW_CREDENTIAL_HEADER,
} as const;

/** Whether the request carries a preview credential at all, good or bad. Checkout refuses on this alone. */
export function carriesPreviewCredential(request: NextRequest): boolean {
  return request.headers.has(PREVIEW_CREDENTIAL_HEADER);
}

/**
 * Is this request a preview of exactly this store? The one question every storefront route asks. No header, a link for
 * another store, an expired or changed link and a missing secret are all simply no, and the route behaves as Live.
 */
export async function isPreviewRequest(request: NextRequest, storeId: string): Promise<boolean> {
  const token = request.headers.get(PREVIEW_CREDENTIAL_HEADER);
  if (token === null) return false;
  return (await readPreviewLink(token, storeId)).ok;
}

/** handleStorefrontError, keeping a preview's refusals as uncacheable as its answers. */
export function storefrontFailure(err: unknown, preview: boolean): NextResponse {
  const response = handleStorefrontError(err);
  if (preview) {
    for (const [name, value] of Object.entries(PREVIEW_RESPONSE_HEADERS)) response.headers.set(name, value);
  }
  return response;
}
