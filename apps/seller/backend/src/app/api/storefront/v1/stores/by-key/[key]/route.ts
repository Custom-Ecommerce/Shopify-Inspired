import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { connectSellerDb } from '@/lib/mongo';
import { Store } from '@/lib/services';
import {
  PUBLIC_CACHE_HEADERS,
  databaseUnavailable,
  handleStorefrontError,
  storeNotFound,
} from '@/lib/storefront/errors';
import { toStorefrontStoreDto, type StoreRow } from '@/lib/storefront/store-dto';
import { buildStoreLookup, parseLookupBy } from '@/lib/storefront/store-key';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type InactiveStatus = 'pending' | 'suspended' | 'archived';

/**
 * GET /api/storefront/v1/stores/by-key/:key?by=slug|handle|domain
 *
 * Public: no session. Resolves a store by slug, internal handle, or verified custom domain.
 *   200 { data: <store> }                  the store is active
 *   200 { data: { status } }               the store exists but is pending, suspended, or archived (nothing else is exposed)
 *   404 STORE_NOT_FOUND                    unknown or malformed key, or a domain that is not verified
 *   400 INVALID_REQUEST                    ?by= is not one of slug, handle, domain
 */
export async function GET(request: NextRequest, context: { params: Promise<{ key: string }> }): Promise<Response> {
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

    if (store.status !== 'active') {
      return NextResponse.json({ data: { status: store.status as InactiveStatus } }, { headers: PUBLIC_CACHE_HEADERS });
    }

    return NextResponse.json({ data: await toStorefrontStoreDto(store) }, { headers: PUBLIC_CACHE_HEADERS });
  } catch (err) {
    return handleStorefrontError(err);
  }
}
