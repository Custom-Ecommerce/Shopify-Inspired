import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseIntParam } from '@/lib/http';
import { PUBLIC_CACHE_HEADERS } from '@/lib/storefront/errors';
import { PREVIEW_RESPONSE_HEADERS, isPreviewRequest, storefrontFailure } from '@/lib/storefront/preview-request';
import { ARTICLE_LIST_DEFAULT_LIMIT, ARTICLE_LIST_MAX_LIMIT, listPublishedArticles } from '@/lib/storefront/content-read';
import { loadActiveStore } from '@/lib/storefront/store-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/storefront/v1/stores/:id/articles?page=&limit= (Sprint 7, S7-B3)
 *
 * Public: no session. The PUBLISHED blog articles of one active store, newest first: title, slug, summary, cover address, tags and publish date. A draft
 * or archived article is never in it, not even in a seller's preview. The text is not in the list (GET .../articles/:slug has it, as a safe tree).
 *
 *   200 { data: [...], page, totalPages, totalDocs }
 *   404 STORE_NOT_FOUND   malformed or unknown store id
 *   403 STORE_NOT_ACTIVE  the store exists but is not serving
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  let preview = false;
  try {
    const { id } = await context.params;
    preview = await isPreviewRequest(request, id);
    await loadActiveStore(id, { preview });
    const params = request.nextUrl.searchParams;
    const page = parseIntParam(params.get('page'), 1, 1, 10000);
    const limit = parseIntParam(params.get('limit'), ARTICLE_LIST_DEFAULT_LIMIT, 1, ARTICLE_LIST_MAX_LIMIT);
    const list = await listPublishedArticles(id, page, limit);
    return NextResponse.json(list, { headers: preview ? PREVIEW_RESPONSE_HEADERS : PUBLIC_CACHE_HEADERS });
  } catch (err) {
    return storefrontFailure(err, preview);
  }
}
