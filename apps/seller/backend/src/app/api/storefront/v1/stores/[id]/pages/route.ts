import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { PUBLIC_CACHE_HEADERS } from '@/lib/storefront/errors';
import { PREVIEW_RESPONSE_HEADERS, isPreviewRequest, storefrontFailure } from '@/lib/storefront/preview-request';
import { listPublishedPages } from '@/lib/storefront/content-read';
import { loadActiveStore } from '@/lib/storefront/store-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/storefront/v1/stores/:id/pages (Sprint 7, S7-B3)
 *
 * Public: no session. The PUBLISHED static pages of one active store in footer order: slug, title, showInFooter, sortOrder, updatedAt. No text and no
 * draft. The storefront builds its footer links and its sitemap from this.
 *
 *   200 { data: [...] }   404 STORE_NOT_FOUND   403 STORE_NOT_ACTIVE
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  let preview = false;
  try {
    const { id } = await context.params;
    preview = await isPreviewRequest(request, id);
    await loadActiveStore(id, { preview });
    return NextResponse.json({ data: await listPublishedPages(id) }, { headers: preview ? PREVIEW_RESPONSE_HEADERS : PUBLIC_CACHE_HEADERS });
  } catch (err) {
    return storefrontFailure(err, preview);
  }
}
