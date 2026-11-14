import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { SELLER_ALERT_PAGE_DEFAULT, SELLER_ALERT_PAGE_MAX } from '@/lib/contracts';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { handleRouteError, parseIntParam } from '@/lib/http';
import { NO_STORE, requireDatabase, toAlertWire, unreadCount } from '@/lib/seller-alerts';
import { assertCan, SellerAlert } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/alerts?page=&limit= (EP-07.US03.T01). The verified store's alerts, newest first, with the unread count.
 *
 *   200 { docs, totalDocs, page, limit, unread }
 *   401 no session   403 admin, or a store the seller does not own   503 database unavailable
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'read', 'sellerAlerts');
    const params = request.nextUrl.searchParams;
    const page = parseIntParam(params.get('page'), 1, 1, 100000);
    const limit = parseIntParam(params.get('limit'), SELLER_ALERT_PAGE_DEFAULT, 1, SELLER_ALERT_PAGE_MAX);
    await requireDatabase();
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const filter = { store: storeId };
    const [rows, totalDocs, unread] = await Promise.all([
      SellerAlert.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      SellerAlert.countDocuments(filter),
      unreadCount(storeId),
    ]);
    const docs = (rows as unknown[]).map(toAlertWire);
    return NextResponse.json({ docs, totalDocs, page, limit, unread }, { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}
