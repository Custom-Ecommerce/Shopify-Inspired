import type { CommissionReport, CommissionReportQuery } from '@markaz/contracts';
import { HttpError } from '@/lib/http';
import { commissionTotals, unsettledBalance } from '@/lib/ledger-aggregates';
import { ACCOUNT_CODES, karachiDayLabel, resolvePeriod } from '@/lib/contracts';
import { Store, assertCan } from '@/lib/services';

/**
 * Sprint 4 EP-05.US06 (D-090): the commission report of one store and period, for the admin. The same ledger sums as the
 * seller's earnings summary (ledger-aggregates.ts), so the two can never disagree. Reached through a signed internal route.
 */
export async function buildCommissionReport(query: CommissionReportQuery, now: Date = new Date()): Promise<CommissionReport> {
  assertCan('admin', 'read', 'commissionReport');
  const period = resolvePeriod(query, now);
  if (!period.ok) throw new HttpError(422, period.message, ACCOUNT_CODES.BODY_INVALID, period.field);
  const store = (await Store.findById(query.storeId).select('name').lean()) as unknown as { name?: string } | null;
  if (!store) throw new HttpError(404, 'Store not found');

  const [totals, balance] = await Promise.all([commissionTotals(query.storeId, period.start, period.end), unsettledBalance(query.storeId)]);
  return {
    storeId: query.storeId,
    storeName: store.name ?? '',
    period: { key: period.period, from: karachiDayLabel(period.start), to: karachiDayLabel(new Date(period.end.getTime() - 1)) },
    commissionEarned: totals.commission,
    sales: totals.sales,
    ordersCount: totals.orders,
    balance,
  };
}
