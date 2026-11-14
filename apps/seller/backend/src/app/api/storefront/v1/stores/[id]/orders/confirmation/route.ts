import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { normalizePhoneE164, storefrontOrderConfirmationRequestSchema, storefrontOrderLookupResponseSchema } from '@/lib/contracts';
import { Order } from '@/lib/services';
import { PRIVATE_NO_STORE_HEADERS, StorefrontHttpError, handleStorefrontError } from '@/lib/storefront/errors';
import { isValidOrderAccessToken } from '@/lib/storefront/order-access';
import { toOrderDto, type OrderRow } from '@/lib/storefront/order-dto';
import { normalizeOrderId } from '@/lib/storefront/order-id';
import { invalidBody, readJsonBody } from '@/lib/storefront/order-request';
import { ORDER_LOOKUP_LIMIT, enforceRateLimit } from '@/lib/storefront/rate-limit';
import { assertStoreId, loadActiveStore } from '@/lib/storefront/store-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const orderNotFound = (): StorefrontHttpError => new StorefrontHttpError(404, 'ORDER_NOT_FOUND', 'No order matches those details.');

/**
 * POST /api/storefront/v1/stores/:id/orders/confirmation   body: { orderNumber, token }
 *
 * The tab that placed an order reading it back, with the order-access token from the placement instead of a phone number.
 * The answer is the order lookup's. A bad or expired token, another store's order and an unknown order all answer the same
 * 404 ORDER_NOT_FOUND. It shares the lookup's rate-limit count (D-069).
 *
 *   200 { data }   400 INVALID_REQUEST   404 ORDER_NOT_FOUND | STORE_NOT_FOUND   403 STORE_NOT_ACTIVE   429 RATE_LIMITED
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    assertStoreId(id);
    await enforceRateLimit(ORDER_LOOKUP_LIMIT, id, request.headers);
    const store = await loadActiveStore(id);

    const parsed = storefrontOrderConfirmationRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw invalidBody(parsed.error);

    const orderNumber = normalizeOrderId(parsed.data.orderNumber);
    // Checked before the database is asked, so a wrong token learns nothing about which orders exist.
    if (!isValidOrderAccessToken(parsed.data.token, orderNumber, store.id)) throw orderNotFound();

    const row = (await (Order as any).findOne({ store: store.id, orderId: orderNumber }).lean()) as OrderRow | null;
    if (!row) throw orderNotFound();

    const phone = normalizePhoneE164(row.phone ?? '') ?? row.phone ?? '';
    const body = storefrontOrderLookupResponseSchema.parse({ data: toOrderDto({ ...row, phone }) });
    return NextResponse.json(body, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (err) {
    return handleStorefrontError(err);
  }
}
