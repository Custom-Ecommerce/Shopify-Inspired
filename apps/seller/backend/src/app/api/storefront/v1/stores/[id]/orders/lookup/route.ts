import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { normalizePhoneE164, storefrontOrderLookupResponseSchema } from '@/lib/contracts';
import { Order } from '@/lib/services';
import { PRIVATE_NO_STORE_HEADERS, StorefrontHttpError, handleStorefrontError } from '@/lib/storefront/errors';
import { toOrderDto, type OrderRow } from '@/lib/storefront/order-dto';
import { parseLookupRequest, readJsonBody } from '@/lib/storefront/order-request';
import { ORDER_LOOKUP_LIMIT, enforceRateLimit } from '@/lib/storefront/rate-limit';
import { assertStoreId, loadActiveStore } from '@/lib/storefront/store-guard';

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
 * POST /api/storefront/v1/stores/:id/orders/lookup   body: { orderId, phone }
 *
 * Order tracking for guests. There is no login: knowing the order id AND the phone it was placed with is
 * the credential. An unknown order, an order of another store, and a wrong phone all answer the same
 * 404 ORDER_NOT_FOUND, so the endpoint cannot be used to find out which order ids exist. The response is
 * never cached, and attempts are rate limited per client and store.
 *
 *   200 { data }  the order
 *   400 INVALID_REQUEST (malformed body or phone)   404 ORDER_NOT_FOUND   404 STORE_NOT_FOUND
 *   403 STORE_NOT_ACTIVE   429 RATE_LIMITED
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    assertStoreId(id);
    enforceRateLimit(ORDER_LOOKUP_LIMIT, id, request.headers);
    const store = await loadActiveStore(id);

    const { orderId, phone } = parseLookupRequest(await readJsonBody(request));

    // Scoped to this store: an order id from another store is simply not found here.
    const row = (await (Order as any).findOne({ store: store.id, orderId }).lean()) as OrderRow | null;
    if (!row) throw orderNotFound();

    // Older orders may hold a local phone format, so the stored value is normalised before it is compared.
    const stored = normalizePhoneE164(row.phone ?? '');
    if (stored === null || !samePhone(stored, phone)) throw orderNotFound();

    const body = storefrontOrderLookupResponseSchema.parse({ data: toOrderDto({ ...row, phone: stored }) });
    return NextResponse.json(body, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (err) {
    return handleStorefrontError(err);
  }
}
