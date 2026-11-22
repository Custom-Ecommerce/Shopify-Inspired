import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { StorefrontHttpError, PUBLIC_CACHE_HEADERS } from '@/lib/storefront/errors';
import { PREVIEW_RESPONSE_HEADERS, isPreviewRequest, storefrontFailure } from '@/lib/storefront/preview-request';
import { findPublishedArticle } from '@/lib/storefront/content-read';
import { loadActiveStore } from '@/lib/storefront/store-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/storefront/v1/stores/:id/articles/:slug (Sprint 7, S7-B3)
 *
 * Public: no session. One PUBLISHED blog article by slug, its text as the safe tree (never stored text, never HTML). A draft, an archived article, another
 * type and an unknown slug all answer the same 404, so a draft's existence is not revealed.
 *
 *   200 { data: { id, slug, title, excerpt, content, coverImageUrl, tags, seoTitle, seoDescription, publishedAt } }
 *   404 ARTICLE_NOT_FOUND   404 STORE_NOT_FOUND   403 STORE_NOT_ACTIVE
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string; slug: string }> }): Promise<Response> {
  let preview = false;
  try {
    const { id, slug } = await context.params;
    preview = await isPreviewRequest(request, id);
    await loadActiveStore(id, { preview });
    const article = await findPublishedArticle(id, slug);
    if (article === null) throw new StorefrontHttpError(404, 'ARTICLE_NOT_FOUND', 'Article not found.');
    return NextResponse.json({ data: article }, { headers: preview ? PREVIEW_RESPONSE_HEADERS : PUBLIC_CACHE_HEADERS });
  } catch (err) {
    return storefrontFailure(err, preview);
  }
}
