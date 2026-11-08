import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { storefrontOrderTrackingResponseSchema } from '@/lib/contracts';
import { Order } from '@/lib/services';
import { PRIVATE_NO_STORE_HEADERS, StorefrontHttpError, handleStorefrontError } from '@/lib/storefront/errors';
import { toOrderTrackingDto, type OrderTrackingRow } from '@/lib/storefront/order-dto';
import { parseLookupRequest, readJsonBody } from '@/lib/storefront/order-request';
import { ORDER_LOOKUP_LIMIT, enforceRateLimit } from '@/lib/storefront/rate-limit';
import { assertStoreId, loadActiveStore } from '@/lib/storefront/store-guard';
import { normalizePhoneE164 } from '@markaz/platform-kit/phone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const orderNotFound = (): StorefrontHttpError => new StorefrontHttpError(404, 'ORDER_NOT_FOUND', 'No order matches those details.');

/** Both sides are E.164, so equal-length strings: compare without leaking where they differ. */
function samePhone(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * POST /api/storefront/v1/stores/:id/orders/track   body: { orderId, phone }
 *
 * Customer tracking (EP-02 OB-4, D-069). The same credential, phone rules and rate limit as the order lookup (which stays
 * for the confirmation page), but the answer is only the parcel's journey: status, the first date of each status, and the
 * courier and tracking while dispatched or delivered. No name, phone, address, city, items, totals, notes, cancel reason,
 * payment or ids. An unknown order, another store's order and a wrong phone all give the same 404 ORDER_NOT_FOUND body.
 *
 * POST, not GET, so the phone never sits in a URL (browser history, proxy and server logs). The rate limit is the lookup's
 * own bucket (ORDER_LOOKUP_LIMIT), shared, so having two endpoints does not double the attempts a client gets.
 *
 *   200 { data }   400 INVALID_REQUEST   404 ORDER_NOT_FOUND | STORE_NOT_FOUND   403 STORE_NOT_ACTIVE   429 RATE_LIMITED
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    assertStoreId(id);
    enforceRateLimit(ORDER_LOOKUP_LIMIT, id, request.headers);
    const store = await loadActiveStore(id);

    const { orderId, phone } = parseLookupRequest(await readJsonBody(request));

    const row = (await Order.findOne({ store: store.id, orderId })
      .select('orderId status phone createdAt courier trackingNumber trackingUrl statusHistory.to statusHistory.at')
      .lean()) as unknown as (OrderTrackingRow & { phone?: string | null }) | null;
    if (!row) throw orderNotFound();

    // Older orders may hold a local phone format, so the stored value is normalised before it is compared.
    const stored = normalizePhoneE164(row.phone ?? '');
    if (stored === null || !samePhone(stored, phone)) throw orderNotFound();

    const body = storefrontOrderTrackingResponseSchema.parse({ data: toOrderTrackingDto(row) });
    return NextResponse.json(body, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (err) {
    return handleStorefrontError(err);
  }
}
