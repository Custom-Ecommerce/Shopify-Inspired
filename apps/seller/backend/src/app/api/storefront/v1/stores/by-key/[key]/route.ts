import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { connectSellerDb } from '@/lib/mongo';
import { Store } from '@/lib/services';
import { PUBLIC_CACHE_HEADERS, databaseUnavailable, storeNotFound } from '@/lib/storefront/errors';
import { PREVIEW_RESPONSE_HEADERS, isPreviewRequest, storefrontFailure } from '@/lib/storefront/preview-request';
import { toStorefrontStoreDto, type StoreRow } from '@/lib/storefront/store-dto';
import { servesStore } from '@/lib/storefront/store-guard';
import { buildStoreLookup, parseLookupBy } from '@/lib/storefront/store-key';
import { domainCacheHeaders } from '@/lib/storefront/domain-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type InactiveStatus = 'pending' | 'suspended' | 'archived';

/**
 * GET /api/storefront/v1/stores/by-key/:key?by=slug|handle|domain
 *
 * Public: no session. Resolves a store by slug, internal handle, or verified custom domain.
 *   200 { data: <store> }                  the store is active
 *   200 { data: { status } }               the store exists but is pending, suspended, or archived (nothing else is exposed)
 *   200 { data: <store>, preview: true }   the preview credential is good for this store, and it is active or pending
 *   404 STORE_NOT_FOUND                    unknown or malformed key, or a domain that is not verified (unknown, pending, failed and disconnected hosts all
 *                                          answer the same 404: nothing says why). By domain, the answer carries a cache tag keyed by the host (S7-B6).
 *   400 INVALID_REQUEST                    ?by= is not one of slug, handle, domain
 */
export async function GET(request: NextRequest, context: { params: Promise<{ key: string }> }): Promise<Response> {
  let preview = false;
  try {
    const { key } = await context.params;
    const by = parseLookupBy(request.nextUrl.searchParams.get('by'));
    const lookup = buildStoreLookup(decodeURIComponent(key), by);
    // A key that cannot be a store never reaches the database.
    if (!lookup) throw storeNotFound();

    await connectSellerDb().catch(() => {
      throw databaseUnavailable();
    });

    const store = (await (Store as any).findOne(lookup.filter).lean()) as (StoreRow & { status: string }) | null;
    if (!store) throw storeNotFound();

    // S7-B6: a preview belongs to the store's subdomain (host-only cookie): a lookup by custom domain never honours one.
    preview = lookup.by !== 'domain' && servesStore(store.status, true) && (await isPreviewRequest(request, String(store._id)));
    if (preview) {
      const status = store.status === 'pending' ? 'pending' : 'active';
      return NextResponse.json({ data: await toStorefrontStoreDto(store, status), preview: true }, { headers: PREVIEW_RESPONSE_HEADERS });
    }

    const headers = lookup.by === 'domain' ? domainCacheHeaders(lookup.key) : PUBLIC_CACHE_HEADERS;
    if (store.status !== 'active') {
      return NextResponse.json({ data: { status: store.status as InactiveStatus } }, { headers });
    }

    return NextResponse.json({ data: await toStorefrontStoreDto(store) }, { headers });
  } catch (err) {
    return storefrontFailure(err, preview);
  }
}
