import type { NextRequest } from 'next/server';
import { listCustomers } from '@/lib/customers';
import { customerListQuerySchema } from '@/lib/contracts';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { parseIntParam } from '@/lib/http';
import { MOBILE_PAGE_DEFAULT, MOBILE_PAGE_MAX, mobileDatabase, mobileError, mobileJson, requireSellerApp, parseMobile } from '@/lib/mobile-api';
import { revisionOf } from '@/lib/mobile-revision';
import { assertCan } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/v1/customers?q=&sort=&repeat=1&hasEmail=1&phone=1&page=&limit= (x-store-id required). The portal's customers (derived from orders), at
 * most 50 a page. A customer's revision is their last order.
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await requireSellerApp(request);
    assertCan(ctx.actor, 'read', 'customers');
    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    params.limit = String(parseIntParam(request.nextUrl.searchParams.get('limit'), MOBILE_PAGE_DEFAULT, 1, MOBILE_PAGE_MAX));
    const query = parseMobile(params, customerListQuerySchema);
    await mobileDatabase();
    const storeId = await resolveOwnedStoreId(request, ctx, null, { requireStore: true, capability: 'customers.read' });
    const list = await listCustomers(storeId, query);
    return mobileJson({
      docs: list.docs.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        whatsapp: row.whatsapp,
        orderCount: row.orderCount,
        deliveredCount: row.deliveredCount,
        totalSpent: row.totalSpent,
        lastOrderAt: row.lastOrderAt,
        tags: row.tags,
        revision: revisionOf(row.lastOrderAt),
        updatedAt: row.lastOrderAt ?? new Date(0).toISOString(),
      })),
      page: list.page,
      limit: list.limit,
      totalDocs: list.totalDocs,
      totalPages: list.totalPages,
    });
  } catch (err) {
    return mobileError(err);
  }
}
