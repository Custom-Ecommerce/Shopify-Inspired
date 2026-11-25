import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { storefrontEventRequestSchema } from '@/lib/contracts';
import { recordStorefrontEvent } from '@/lib/storefront-stats';
import { PRIVATE_NO_STORE_HEADERS, databaseUnavailable, handleStorefrontError } from '@/lib/storefront/errors';
import { invalidBody, readJsonBody } from '@/lib/storefront/order-request';
import { carriesPreviewCredential } from '@/lib/storefront/preview-request';
import { EVENT_LIMIT, enforceRateLimit } from '@/lib/storefront/rate-limit';
import { loadActiveStore } from '@/lib/storefront/store-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/storefront/v1/events { store, event: page_view | product_view | add_to_cart | checkout_start, productSlug? } (S8-B6, D-118)
 *
 * Anonymous counters. The storefront server proxies the browser's event here; nothing identifies the shopper and nothing about them is stored. Order: shape
 * (400, unknown keys included), the Mongo rate limit by signed client address AND store (429), preview (never counted), the store must be live (404 / 403),
 * then the write. A product view of a slug that is no live product of the store is ignored. Success is answered only after the write (503 when it fails).
 *
 *   200 { data: { received: true } }
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const parsed = storefrontEventRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw invalidBody(parsed.error);
    const { store, event, productSlug } = parsed.data;
    await enforceRateLimit(EVENT_LIMIT, store, request.headers);
    // A seller looking at their own preview is not a visitor.
    if (!carriesPreviewCredential(request)) {
      await loadActiveStore(store);
      try {
        await recordStorefrontEvent(store, event, productSlug);
      } catch (err) {
        console.error('[seller-backend] could not count a storefront event', err instanceof Error ? err.name : 'unknown');
        throw databaseUnavailable();
      }
    }
    return NextResponse.json({ data: { received: true } }, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (err) {
    return handleStorefrontError(err);
  }
}
