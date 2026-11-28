import type { NextRequest } from 'next/server';
import { MOBILE_ORDER_PAYMENT_FILTERS, type MobileOrderPaymentFilter } from '@/lib/contracts';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { MOBILE_PAGE_MAX, mobileDatabase, mobileError, mobileJson, mobileOrderItem, requireSellerApp, pageNumbers } from '@/lib/mobile-api';
import { readOrderListPage } from '@/lib/order-list';
import { OrderRequestError, parseOrderListRequest } from '@/lib/orders';
import { assertCan, ORDER_ACTIONS } from '@/lib/services';

/** The phone's payment filter. cod: anything that is not a card order. paid: the money has arrived (card paid, or cash collected). */
const PAYMENT_CONDITIONS: Record<MobileOrderPaymentFilter, Record<string, unknown>> = {
  cod: { paymentMethod: { $ne: 'card' } },
  paid: { paymentStatus: { $in: ['paid', 'collected'] } },
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/v1/orders?status=&from=&to=&q=&confirmation=&payment=&page=&limit= (x-store-id required). The portal's order list and filters, newest first; at
 * most 50 a page.   200 { docs, page, limit, totalDocs, totalPages, counts, unconfirmedCount }   400 ORDER_... or STORE_ID_REQUIRED   401   403
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await requireSellerApp(request);
    assertCan(ctx.actor, ORDER_ACTIONS.view.operation, ORDER_ACTIONS.view.collection);
    // The app has no generic ?where or ?sort.
    const params = new URLSearchParams(request.nextUrl.searchParams);
    params.delete('where');
    params.delete('sort');
    const payment = params.get('payment') || null;
    params.delete('payment');
    if (payment !== null && !(MOBILE_ORDER_PAYMENT_FILTERS as readonly string[]).includes(payment)) {
      throw new OrderRequestError(400, 'ORDER_QUERY_INVALID', 'payment must be cod or paid.');
    }
    const mode = parseOrderListRequest(params);
    if (mode.mode !== 'list') throw new OrderRequestError(400, 'ORDER_QUERY_INVALID', 'The order list query is not valid.');
    const query = { ...mode.query, limit: Math.min(mode.query.limit, MOBILE_PAGE_MAX) };
    await mobileDatabase();
    const storeId = await resolveOwnedStoreId(request, ctx, null, { requireStore: true, capability: 'orders.read' });
    const { rows, totalDocs, counts, unconfirmedCount } = await readOrderListPage(storeId, query, payment ? PAYMENT_CONDITIONS[payment as MobileOrderPaymentFilter] : {});
    return mobileJson({ docs: rows.map(mobileOrderItem), ...pageNumbers(totalDocs, query.page, query.limit), counts, unconfirmedCount });
  } catch (err) {
    return mobileError(err);
  }
}
