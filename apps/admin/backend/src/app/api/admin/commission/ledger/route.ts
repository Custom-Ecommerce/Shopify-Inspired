import { errorResponse } from '@/lib/admin-auth';
import {
  LEDGER_FIELDS,
  LEDGER_SELECT,
  STORE_MATCH_LIMIT,
  buildLedgerFilter,
  buildStoreMatchFilter,
  parseLedgerQuery,
  toLedgerRow,
  toLedgerTotals,
} from '@/lib/admin-commission';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import { idOf, listEnvelope, type Doc } from '@/lib/admin-stores';
import { assertCan, CommissionLedgerModel, Store } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/commission/ledger. The commission ledger for the operator console, newest first, in the list
 * envelope: filter by status, and search by store (name, slug, domain, or id) or settlement reference. Each row
 * carries the store's name. Only the fields the admin policy may read are selected, so no order identifier,
 * payment intent, or application fee id is returned. The answer also holds the totals by status over the whole
 * ledger. Read only: the ledger is written by the billing webhook, never from the console.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await authorizeAdmin(request);
    requirePolicy(() => {
      assertCan('admin', 'read', 'commissionLedger', LEDGER_FIELDS);
      assertCan('admin', 'read', 'stores');
    });

    const parsed = parseLedgerQuery(new URL(request.url).searchParams);
    if (!parsed.ok) return Response.json({ error: 'Invalid request', issues: parsed.issues }, { status: 422, headers: NO_STORE });
    const { query } = parsed;

    let matchedStoreIds: string[] = [];
    if (query.q !== null) {
      const matched = (await Store.find(buildStoreMatchFilter(query.q) as never)
        .select('_id')
        .limit(STORE_MATCH_LIMIT)
        .lean()) as unknown as Doc[];
      matchedStoreIds = matched.map((doc) => String(doc._id));
    }
    const filter = buildLedgerFilter(query, matchedStoreIds) as never;

    const [rows, totalDocs, groups] = await Promise.all([
      CommissionLedgerModel.find(filter)
        .select(LEDGER_SELECT)
        .sort({ createdAt: -1, _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      CommissionLedgerModel.countDocuments(filter),
      CommissionLedgerModel.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 }, orderAmount: { $sum: '$orderAmount' }, commissionAmount: { $sum: '$commissionAmount' } } },
      ]),
    ]);
    const docs = rows as unknown as Doc[];

    const storeIds = [...new Set(docs.map((doc) => idOf(doc.store)).filter((id): id is string => id !== null))];
    const storeNames = new Map<string, string>();
    if (storeIds.length > 0) {
      const stores = (await Store.find({ _id: { $in: storeIds } } as never)
        .select('name')
        .lean()) as unknown as Doc[];
      for (const store of stores) storeNames.set(String(store._id), typeof store.name === 'string' ? store.name : '');
    }

    const envelope = listEnvelope(
      docs.map((doc) => toLedgerRow(doc, storeNames)),
      { page: query.page, limit: query.limit, totalDocs },
    );
    return Response.json({ ...envelope, totals: toLedgerTotals(groups) }, { status: 200, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
