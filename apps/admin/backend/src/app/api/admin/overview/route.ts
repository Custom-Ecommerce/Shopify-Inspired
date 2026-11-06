import { errorResponse } from '@/lib/admin-auth';
import { OVERVIEW_LEDGER_FIELDS, newSellerSince, toOverview } from '@/lib/admin-overview';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import type { Doc } from '@/lib/admin-stores';
import { SYNC_STATUSES } from '@/lib/admin-sync';
import { assertCan, CommissionLedgerModel, Store, SyncOutbox, User } from '@/lib/workspace';

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
    await authorizeAdmin(request);
    requirePolicy(() => {
      assertCan('admin', 'read', 'stores');
      assertCan('admin', 'read', 'users', ['role', 'createdAt']);
      assertCan('admin', 'read', 'commissionLedger', OVERVIEW_LEDGER_FIELDS);
      assertCan('admin', 'read', 'sync-outbox');
    });

    const now = new Date();
    const [storeGroups, sellerTotal, sellerRecent, ledgerGroups, outboxCounts, oldestPending, lastSent] = await Promise.all([
      Store.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      User.countDocuments({ role: 'seller' } as never),
      User.countDocuments({ role: 'seller', createdAt: { $gte: newSellerSince(now) } } as never),
      CommissionLedgerModel.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 }, orderAmount: { $sum: '$orderAmount' }, commissionAmount: { $sum: '$commissionAmount' } } },
      ]),
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
        ledgerGroups,
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
