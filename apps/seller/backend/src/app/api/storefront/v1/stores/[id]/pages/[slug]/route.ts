import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { StorefrontHttpError, PUBLIC_CACHE_HEADERS } from '@/lib/storefront/errors';
import { PREVIEW_RESPONSE_HEADERS, isPreviewRequest, storefrontFailure } from '@/lib/storefront/preview-request';
import { findPage } from '@/lib/storefront/content-read';
import { loadActiveStore } from '@/lib/storefront/store-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/storefront/v1/stores/:id/pages/:slug (Sprint 7, S7-B3)
 *
 * Public: no session. One static page of one active store, its text as the safe tree.
 *
 *   200 { data: { slug, title, content, publishedAt, updatedAt } }
 *   404 PAGE_NOT_FOUND      the store has no page at this address: the storefront may show its default copy (about, contact)
 *   404 PAGE_NOT_PUBLISHED  the store has a page there but it is a draft: the storefront shows a 404 and NO default copy
 *   404 STORE_NOT_FOUND   403 STORE_NOT_ACTIVE
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string; slug: string }> }): Promise<Response> {
  let preview = false;
  try {
    const { id, slug } = await context.params;
    preview = await isPreviewRequest(request, id);
    await loadActiveStore(id, { preview });
    const found = await findPage(id, slug);
    if (found.kind === 'none') throw new StorefrontHttpError(404, 'PAGE_NOT_FOUND', 'Page not found.');
    if (found.kind === 'draft') throw new StorefrontHttpError(404, 'PAGE_NOT_PUBLISHED', 'Page not found.');
    return NextResponse.json({ data: found.page }, { headers: preview ? PREVIEW_RESPONSE_HEADERS : PUBLIC_CACHE_HEADERS });
  } catch (err) {
    return storefrontFailure(err, preview);
  }
}
