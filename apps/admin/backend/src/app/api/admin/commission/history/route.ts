import { errorResponse } from '@/lib/admin-auth';
import { buildHistoryFilter, parseHistoryQuery, toHistoryRow } from '@/lib/admin-commission-rates';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import { listEnvelope, type Doc } from '@/lib/admin-stores';
import { assertCan, CommissionRateHistory, Store } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/commission/history?storeId=&scope=&page=&limit=. Who changed which rate, from what to what, when and why,
 * newest first, in the list envelope. Read only.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await authorizeAdmin(request, 'commission.read');
    requirePolicy(() => assertCan('admin', 'read', 'stores'));
    const parsed = parseHistoryQuery(new URL(request.url).searchParams);
    if (!parsed.ok) return Response.json({ error: 'Invalid request', issues: parsed.issues }, { status: 422, headers: NO_STORE });
    const { query } = parsed;
    const filter = buildHistoryFilter(query) as never;
    const [rows, totalDocs] = await Promise.all([
      CommissionRateHistory.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      CommissionRateHistory.countDocuments(filter),
    ]);
    const docs = rows as unknown as Doc[];
    const ids = [...new Set(docs.map((row) => (row.store ? String(row.store) : '')).filter((id) => id !== ''))];
    const stores = ids.length === 0 ? [] : ((await Store.find({ _id: { $in: ids } } as never).select('name').lean()) as unknown as Doc[]);
    const names = new Map(stores.map((store) => [String(store._id), typeof store.name === 'string' ? store.name : '']));
    return Response.json(listEnvelope(docs.map((row) => toHistoryRow(row, names)), { page: query.page, limit: query.limit, totalDocs }), { status: 200, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
