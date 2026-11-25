import type { CommissionReport, CommissionReportQuery } from '@markaz/contracts';
import { HttpError } from '@/lib/http';
import { commissionTotals, unsettledBalance } from '@/lib/ledger-aggregates';
import { ACCOUNT_CODES, karachiDayLabel, resolvePeriod } from '@/lib/contracts';
import { Store, assertCan } from '@/lib/services';

/**
 * Sprint 4 EP-05.US06 (D-090): the commission report of one store and period, for the admin. The same ledger sums as the
 * seller's earnings summary (ledger-aggregates.ts), so the two can never disagree. Reached through a signed internal route.
 * Sprint 6 D-116: also split into cash on delivery (cod) and gateway (card) rows, each from the same ledger.
 */
export async function buildCommissionReport(query: CommissionReportQuery, now: Date = new Date()): Promise<CommissionReport> {
  assertCan('admin', 'read', 'commissionReport');
  const period = resolvePeriod(query, now);
  if (!period.ok) throw new HttpError(422, period.message, ACCOUNT_CODES.BODY_INVALID, period.field);
  const store = (await Store.findById(query.storeId).select('name').lean()) as unknown as { name?: string } | null;
  if (!store) throw new HttpError(404, 'Store not found');

  const [totals, cod, gateway, balance] = await Promise.all([
    commissionTotals(query.storeId, period.start, period.end),
    commissionTotals(query.storeId, period.start, period.end, ['cod_commission']),
    commissionTotals(query.storeId, period.start, period.end, ['card_commission']),
    unsettledBalance(query.storeId),
  ]);
  const part = (t: { commission: number; sales: number; orders: number }) => ({ commissionEarned: t.commission, sales: t.sales, ordersCount: t.orders });
  return {
    storeId: query.storeId,
    storeName: store.name ?? '',
    period: { key: period.period, from: karachiDayLabel(period.start), to: karachiDayLabel(new Date(period.end.getTime() - 1)) },
    commissionEarned: totals.commission,
    sales: totals.sales,
    // commissionTotals already leaves a return's reversal out of the count: a partial return reverses part of the commission and the order stays.
    ordersCount: totals.orders,
    balance,
    // Sprint 6 D-116: the same sums by payment kind. COD carries a commission of 0 while the platform's COD percent is 0.
    cod: part(cod),
    gateway: part(gateway),
  };
}
