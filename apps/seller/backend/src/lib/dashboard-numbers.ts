import mongoose, { type PipelineStage } from 'mongoose';
import type { SellerRole } from '@markaz/auth';
import { byDayStatusPipeline, dayKeys, orderSummary, periodStart } from '@/lib/analytics';
import { ORDER_LIST_SORT } from '@/lib/orders';
import { lowStockCondition } from '@/lib/product-list';
import { Order, Product, sellerCan } from '@/lib/services';

/*
 * Sprint 9 (EP-31.US03.T01): the numbers of the portal's overview page, for the phone. The same definitions: orders created since the start of the server's
 * day; pending orders; products with a tracked variant at the low-stock line; the total of this month's delivered orders; the newest 8 orders. What a role
 * cannot see on the web it does not get here (money: the owner; stock: roles that read products).
 */

export const RECENT_ORDERS = 8;
const SALES_DAYS = 7;

/** Today and the last seven days with the analytics page's own rules (which orders are money, UTC days). */
async function readSales(storeId: string, now: Date): Promise<{ today: number; week: number }> {
  const since = periodStart(now, SALES_DAYS);
  const pipeline = byDayStatusPipeline(new mongoose.Types.ObjectId(storeId), since);
  const grouped = await Order.aggregate(pipeline as unknown as PipelineStage[]);
  const { daily } = orderSummary(grouped as Array<Record<string, unknown>>, dayKeys(since, SALES_DAYS));
  return { today: daily[daily.length - 1]!.amount, week: daily.reduce((sum, day) => sum + day.amount, 0) };
}

export interface DashboardNumbers {
  ordersToday: number;
  pendingOrders: number;
  unconfirmedOrders: number;
  lowStockProducts: number | null;
  revenueThisMonth: number | null;
  salesToday: number | null;
  salesThisWeek: number | null;
  recentRows: unknown[];
}

export async function readDashboardNumbers(storeId: string, role: SellerRole | null, now: Date = new Date()): Promise<DashboardNumbers> {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const [ordersToday, pendingOrders, unconfirmedOrders, lowStockProducts, revenue, recentRows, sales] = await Promise.all([
    Order.countDocuments({ store: storeId, createdAt: { $gte: startOfToday } }),
    Order.countDocuments({ store: storeId, status: 'pending' }),
    Order.countDocuments({ store: storeId, confirmationStatus: 'unconfirmed', status: { $ne: 'cancelled' } }),
    sellerCan(role, 'products.read') ? Product.countDocuments({ store: storeId, deletedAt: null, variants: lowStockCondition() } as never) : Promise.resolve(null),
    // An aggregate casts nothing: the store is given as the rows hold it.
    sellerCan(role, 'earnings.read')
      ? Order.aggregate<{ total: number }>([
          { $match: { store: new mongoose.Types.ObjectId(storeId), status: 'delivered', createdAt: { $gte: startOfMonth } } },
          { $group: { _id: null, total: { $sum: { $ifNull: ['$total', 0] } } } },
        ])
      : Promise.resolve(null),
    Order.find({ store: storeId }).sort(ORDER_LIST_SORT).limit(RECENT_ORDERS).lean(),
    sellerCan(role, 'analytics.read') ? readSales(storeId, now) : Promise.resolve(null),
  ]);
  return {
    ordersToday,
    pendingOrders,
    unconfirmedOrders,
    lowStockProducts,
    revenueThisMonth: revenue === null ? null : Math.max(0, Math.round(revenue[0]?.total ?? 0)),
    salesToday: sales?.today ?? null,
    salesThisWeek: sales?.week ?? null,
    recentRows: recentRows as unknown[],
  };
}
