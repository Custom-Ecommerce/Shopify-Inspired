import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { handleRouteError } from '@/lib/http';
import { NO_STORE, requireDatabase, unreadCount } from '@/lib/seller-alerts';
import { assertCan } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/alerts/unread-count: { unread } for the verified store. The bell polls this every 60 seconds. */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'read', 'sellerAlerts');
    await requireDatabase();
    const storeId = await resolveOwnedStoreId(request, ctx, null);
    return NextResponse.json({ unread: await unreadCount(storeId) }, { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}
