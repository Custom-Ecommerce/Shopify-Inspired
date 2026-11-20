import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ANALYTICS_PERIODS } from '@/lib/contracts';
import { authenticate } from '@/lib/auth';
import { HttpError, handleRouteError, jsonError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan, Order } from '@/lib/services';
import { resolveOwnedStoreId } from '@/lib/data-plane';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PERIOD_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
const REVENUE_EXCLUDED = ['cancelled', 'returned'];
const TOP_CITIES = 5;
const TOP_PRODUCTS = 10;

interface OrderRow {
  status: string;
  city?: string | null;
  total?: number;
  createdAt: Date | string;
  items?: Array<{ productId: string; productTitle: string; unitPrice: number; quantity: number }>;
}

/** The UTC day of a date, as YYYY-MM-DD. */
function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * GET /api/analytics?period=7d|30d|90d. The store's order analytics for the period. Computed from the store's
 * orders in memory (ID-28): correct for the current order volume, and to be moved into the database when it grows.
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'read', 'orders');

    const period = request.nextUrl.searchParams.get('period') ?? '30d';
    if (!(ANALYTICS_PERIODS as readonly string[]).includes(period)) {
      return jsonError(422, 'period must be 7d, 30d, or 90d');
    }
    const days = PERIOD_DAYS[period];

    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const now = new Date();
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));
    const rows = (await Order.find({ store: storeId })
      .select('status city total createdAt items')
      .lean()) as unknown as OrderRow[];
    const inPeriod = rows.filter((row) => new Date(row.createdAt) >= since);
    const counted = inPeriod.filter((row) => row.status !== 'cancelled');
    const revenueRows = inPeriod.filter((row) => !REVENUE_EXCLUDED.includes(row.status));

    const ordersByStatus: Record<string, number> = {};
    for (const row of inPeriod) ordersByStatus[row.status] = (ordersByStatus[row.status] ?? 0) + 1;

    const revenueTotal = revenueRows.reduce((sum, row) => sum + Number(row.total ?? 0), 0);
    const avgOrderValue = revenueRows.length ? Math.round(revenueTotal / revenueRows.length) : 0;

    const dailyMap = new Map<string, number>();
    for (let i = 0; i < days; i += 1) {
      dailyMap.set(dayOf(new Date(since.getTime() + i * 86400000)), 0);
    }
    for (const row of revenueRows) {
      const key = dayOf(new Date(row.createdAt));
      if (dailyMap.has(key)) dailyMap.set(key, (dailyMap.get(key) ?? 0) + Number(row.total ?? 0));
    }
    const daily = [...dailyMap.entries()].map(([date, amount]) => ({ date, amount }));

    const cityCounts = new Map<string, number>();
    for (const row of counted) {
      const city = (row.city ?? '').trim();
      if (city) cityCounts.set(city, (cityCounts.get(city) ?? 0) + 1);
    }
    const topCities = [...cityCounts.entries()]
      .map(([city, orders]) => ({ city, orders }))
      .sort((a, b) => b.orders - a.orders || a.city.localeCompare(b.city))
      .slice(0, TOP_CITIES);

    const products = new Map<string, { id: string; title: string; revenue: number; orders: number }>();
    for (const row of revenueRows) {
      const seen = new Set<string>();
      for (const item of row.items ?? []) {
        const entry = products.get(item.productId) ?? { id: item.productId, title: item.productTitle, revenue: 0, orders: 0 };
        entry.revenue += item.unitPrice * item.quantity;
        if (!seen.has(item.productId)) {
          entry.orders += 1;
          seen.add(item.productId);
        }
        products.set(item.productId, entry);
      }
    }
    const topProducts = [...products.values()].sort((a, b) => b.revenue - a.revenue).slice(0, TOP_PRODUCTS);

    return NextResponse.json(
      {
        period,
        totalOrders: counted.length,
        avgOrderValue,
        ordersByStatus,
        revenue: { daily },
        topCities,
        topProducts,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
