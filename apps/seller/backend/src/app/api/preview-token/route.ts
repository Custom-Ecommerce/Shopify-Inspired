import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { HttpError, handleRouteError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { signPreviewLink } from '@/lib/preview-token';
import { Store, assertCan } from '@/lib/services';
import { storePreviewUrl } from '@/lib/storefront/preview-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/preview-token
 *
 * A fresh preview link for the seller's store, valid for 24 hours (D-019). Which store comes from resolveOwnedStoreId and
 * never from the body. The link is a credential, so it is not cacheable anywhere.
 *
 *   200 { url, expiresAt }
 *   401 no session    403 not this seller's store, or not a seller (D-042)    404 no store
 *   503 PREVIEW_TOKEN_SECRET or STOREFRONT_URL is not set
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'create', 'storePreview');
    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const store = (await Store.findById(storeId).select('slug').lean()) as { slug?: string } | null;
    if (!store?.slug) throw new HttpError(404, 'Store not found');

    const { token, expiresAt } = await signPreviewLink(storeId);
    const url = storePreviewUrl(process.env.STOREFRONT_URL, store.slug, token);
    return NextResponse.json({ url, expiresAt: expiresAt.toISOString() }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
