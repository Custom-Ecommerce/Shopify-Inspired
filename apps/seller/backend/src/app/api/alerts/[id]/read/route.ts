import mongoose from 'mongoose';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { HttpError, handleRouteError } from '@/lib/http';
import { NO_STORE, requireDatabase, toAlertWire, unreadCount } from '@/lib/seller-alerts';
import { assertCan, SellerAlert } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/alerts/:id/read. Marks one alert of the verified store read, in one conditional write (readAt still null).
 * Marking an alert that is already read is a 200 that changes nothing.
 *
 *   200 { alert, unread }   401 no session   403 admin, or a store the seller does not own
 *   404 a bad id, an unknown alert, or another store's alert (its content is not returned)
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'update', 'sellerAlerts', ['readAt']);
    const { id } = await context.params;
    await requireDatabase();
    if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Alert not found');
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const marked = await SellerAlert.findOneAndUpdate({ _id: id, store: storeId, readAt: null }, { $set: { readAt: new Date() } }, { new: true }).lean();
    const alert = marked ?? (await SellerAlert.findOne({ _id: id, store: storeId }).lean());
    if (!alert) throw new HttpError(404, 'Alert not found');

    return NextResponse.json({ alert: toAlertWire(alert), unread: await unreadCount(storeId) }, { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}
