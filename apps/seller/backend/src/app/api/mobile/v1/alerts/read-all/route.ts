import type { NextRequest } from 'next/server';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { mobileDatabase, mobileError, mobileJson, requireSellerApp } from '@/lib/mobile-api';
import { alertFilterFor, unreadCount } from '@/lib/seller-alerts';
import { assertCan, SellerAlert } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/mobile/v1/alerts/read-all (x-store-id required): every unread alert this role sees, in one write.   200 { marked, unread }   401   403 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const ctx = await requireSellerApp(request);
    assertCan(ctx.actor, 'update', 'sellerAlerts', ['readAt']);
    await mobileDatabase();
    const storeId = await resolveOwnedStoreId(request, ctx, null, { requireStore: true, capability: 'alerts.read' });
    const result = await SellerAlert.updateMany({ ...alertFilterFor(storeId, ctx.storeRole), readAt: null }, { $set: { readAt: new Date() } });
    const marked = Number((result as { modifiedCount?: unknown }).modifiedCount ?? 0);
    return mobileJson({ marked, unread: await unreadCount(storeId, ctx.storeRole) });
  } catch (err) {
    return mobileError(err);
  }
}
