import { errorResponse } from '@/lib/admin-auth';
import { SETTINGS_GLOBAL_TYPE, buildRatesFilter, parseRatesQuery, toDefaultRate, toRateRow } from '@/lib/admin-commission';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import { listEnvelope, type Doc } from '@/lib/admin-stores';
import { assertCan, PlatformSettingsModel, Store } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/commission/rates. The commission rate of every store, newest first, in the list envelope: search by
 * name, slug, domain, or id, and filter by rate source (platform default or custom). Each row carries the rate that
 * applies to the store's next order, resolved with the billing package's rule. The answer also holds the platform
 * default rate. Read only: rates are changed through the store and settings writes, not here.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await authorizeAdmin(request);
    requirePolicy(() => {
      assertCan('admin', 'read', 'stores');
      assertCan('admin', 'read', 'platformSettings');
    });

    const parsed = parseRatesQuery(new URL(request.url).searchParams);
    if (!parsed.ok) return Response.json({ error: 'Invalid request', issues: parsed.issues }, { status: 422, headers: NO_STORE });
    const { query } = parsed;
    const filter = buildRatesFilter(query) as never;

    const [settings, rows, totalDocs] = await Promise.all([
      PlatformSettingsModel.findOne({ globalType: SETTINGS_GLOBAL_TYPE } as never)
        .select('defaultCommissionRate')
        .lean(),
      Store.find(filter)
        .select('name status commissionMode commissionRate')
        .sort({ createdAt: -1, _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      Store.countDocuments(filter),
    ]);
    const defaultRate = toDefaultRate(settings as unknown as Doc | null);
    const envelope = listEnvelope(
      (rows as unknown as Doc[]).map((doc) => toRateRow(doc, defaultRate)),
      { page: query.page, limit: query.limit, totalDocs },
    );
    return Response.json({ ...envelope, defaultRate }, { status: 200, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
