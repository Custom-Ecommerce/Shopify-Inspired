import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { handleRouteError } from '@/lib/http';
import { NO_STORE, requireDatabase, unreadCount } from '@/lib/seller-alerts';
import { assertCan, SellerAlert } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/alerts/read-all. Marks every unread alert of the verified store read, in one write: { marked, unread }. */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'update', 'sellerAlerts', ['readAt']);
    await requireDatabase();
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const result = await SellerAlert.updateMany({ store: storeId, readAt: null }, { $set: { readAt: new Date() } });
    const marked = Number((result as { modifiedCount?: unknown }).modifiedCount ?? 0);
    return NextResponse.json({ marked, unread: await unreadCount(storeId) }, { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}
