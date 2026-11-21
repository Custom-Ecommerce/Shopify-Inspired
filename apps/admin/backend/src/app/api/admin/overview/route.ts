import { errorResponse } from '@/lib/admin-auth';
import { newSellerSince, toOverview } from '@/lib/admin-overview';
import { readKpi } from '@/lib/seller-moderation-client';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import type { Doc } from '@/lib/admin-stores';
import { SYNC_STATUSES } from '@/lib/admin-sync';
import { assertCan, Store, SyncOutbox, User } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/overview. The platform's headline numbers for the operator console, in one answer: stores by status,
 * seller accounts (and how many are new), the commission ledger totals by status, and the sync outbox health. Every
 * number is a count or a sum over the whole collection, read when the request is served. Read only, and nothing
 * identifying is returned: no id, name, email, order, or event payload. A seller is a user with the seller role
 * (ID-33), counted the same way the seller list counts them.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request);
    requirePolicy(() => {
      assertCan('admin', 'read', 'stores');
      assertCan('admin', 'read', 'users', ['role', 'createdAt']);
      // S6-B5 (D-095): the old commission ledger is no longer read here; the KPIs come from the seller backend's NEW ledger.
      assertCan('admin', 'read', 'sync-outbox');
    });

    const now = new Date();
    const [storeGroups, sellerTotal, sellerRecent, kpi, outboxCounts, oldestPending, lastSent] = await Promise.all([
      Store.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      User.countDocuments({ role: 'seller' } as never),
      User.countDocuments({ role: 'seller', createdAt: { $gte: newSellerSince(now) } } as never),
      // The KPIs are one signed call. If the seller backend is down the rest of the overview still answers, with kpi null.
      readKpi(userId).catch((err: unknown) => {
        console.error('[admin-backend] overview KPIs unavailable', err instanceof Error ? err.message : 'unknown');
        return null;
      }),
      Promise.all(SYNC_STATUSES.map((status) => SyncOutbox.countDocuments({ status } as never))),
      SyncOutbox.findOne({ status: 'pending' } as never)
        .sort({ createdAt: 1 })
        .select('createdAt')
        .lean(),
      SyncOutbox.findOne({ status: 'sent' } as never)
        .sort({ sentAt: -1 })
        .select('sentAt')
        .lean(),
    ]);

    const overview = toOverview(
      {
        storeGroups,
        sellerTotal,
        sellerRecent,
        kpi,
        outboxCounts,
        oldestPending: oldestPending as unknown as Doc | null,
        lastSent: lastSent as unknown as Doc | null,
      },
      now,
    );
    return Response.json(overview, { status: 200, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
