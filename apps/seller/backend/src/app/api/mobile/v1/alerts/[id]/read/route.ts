import type { NextRequest } from 'next/server';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { HttpError } from '@/lib/http';
import { mobileDatabase, mobileError, mobileJson, recordId, requireSellerApp } from '@/lib/mobile-api';
import { alertFilterFor, unreadCount } from '@/lib/seller-alerts';
import { assertCan, SellerAlert } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/v1/alerts/:id/read (x-store-id required): the portal's "mark read", one conditional write. Repeating it changes nothing, so it needs no
 * Idempotency-Key.   200 { id, unread }   401   403   404 an unknown alert, another store's, or one this role does not see
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await requireSellerApp(request);
    assertCan(ctx.actor, 'update', 'sellerAlerts', ['readAt']);
    const { id } = await context.params;
    await mobileDatabase();
    recordId(id, 'Alert');
    const storeId = await resolveOwnedStoreId(request, ctx, null, { requireStore: true, capability: 'alerts.read' });
    const visible = { _id: id, ...alertFilterFor(storeId, ctx.storeRole) };
    const marked = await SellerAlert.findOneAndUpdate({ ...visible, readAt: null }, { $set: { readAt: new Date() } }, { new: true }).lean();
    if (!marked && !(await SellerAlert.findOne(visible).lean())) throw new HttpError(404, 'Alert not found');
    return mobileJson({ id, unread: await unreadCount(storeId, ctx.storeRole) });
  } catch (err) {
    return mobileError(err);
  }
}
