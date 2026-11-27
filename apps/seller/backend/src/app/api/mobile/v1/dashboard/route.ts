import type { NextRequest } from 'next/server';
import { readDashboardNumbers } from '@/lib/dashboard-numbers';
import { resolveStoreAccess } from '@/lib/data-plane';
import { mobileDatabase, mobileError, mobileJson, mobileOrderItem, requireSellerApp } from '@/lib/mobile-api';
import { assertCan, ORDER_ACTIONS } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/v1/dashboard (x-store-id required): the overview numbers of the portal, for one store.
 *   200   400 STORE_ID_REQUIRED   401   403 not a seller, a foreign store or a role without orders
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await requireSellerApp(request);
    assertCan(ctx.actor, ORDER_ACTIONS.view.operation, ORDER_ACTIONS.view.collection);
    await mobileDatabase();
    const { storeId, role } = await resolveStoreAccess(request, ctx, null, { requireStore: true, capability: 'orders.read' });
    const { recentRows, ...numbers } = await readDashboardNumbers(storeId, role);
    const recentOrders = recentRows.map(mobileOrderItem);
    return mobileJson({
      storeId,
      ...numbers,
      recentOrders,
      // The newest change among what is shown; the time of these numbers.
      revision: Math.max(0, ...recentOrders.map((order) => order.revision)),
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return mobileError(err);
  }
}
