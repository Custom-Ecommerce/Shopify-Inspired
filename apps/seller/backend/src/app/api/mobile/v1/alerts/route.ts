import type { NextRequest } from 'next/server';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { parseIntParam } from '@/lib/http';
import { MOBILE_PAGE_DEFAULT, MOBILE_PAGE_MAX, mobileDatabase, mobileError, mobileJson, requireSellerApp, pageNumbers } from '@/lib/mobile-api';
import { stampOf } from '@/lib/mobile-revision';
import { alertFilterFor, toAlertWire, unreadCount } from '@/lib/seller-alerts';
import { assertCan, SellerAlert } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/mobile/v1/alerts?page=&limit= (x-store-id required). The bell of the portal: the kinds the role may see, newest first. */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await requireSellerApp(request);
    assertCan(ctx.actor, 'read', 'sellerAlerts');
    const params = request.nextUrl.searchParams;
    const page = parseIntParam(params.get('page'), 1, 1, 100000);
    const limit = parseIntParam(params.get('limit'), MOBILE_PAGE_DEFAULT, 1, MOBILE_PAGE_MAX);
    await mobileDatabase();
    const storeId = await resolveOwnedStoreId(request, ctx, null, { requireStore: true, capability: 'alerts.read' });
    const filter = alertFilterFor(storeId, ctx.storeRole);
    const [rows, totalDocs, unread] = await Promise.all([
      SellerAlert.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      SellerAlert.countDocuments(filter),
      unreadCount(storeId, ctx.storeRole),
    ]);
    const docs = (rows as unknown[]).map((row) => ({ ...toAlertWire(row), ...stampOf(row) }));
    return mobileJson({ docs, ...pageNumbers(totalDocs, page, limit), unread });
  } catch (err) {
    return mobileError(err);
  }
}
