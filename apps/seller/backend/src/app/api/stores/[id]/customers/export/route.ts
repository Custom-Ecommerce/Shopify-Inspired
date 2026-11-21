import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { readQuery } from '@/lib/broadcast';
import { customerExportQuerySchema, CUSTOMER_EXPORT_MAX_ROWS } from '@/lib/contracts';
import { exportCustomers } from '@/lib/customers';
import { handleRouteError } from '@/lib/http';
import { loadOwnedStore, requireSellerActor } from '@/lib/owned-store';
import { assertCan } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/stores/:id/customers/export?q=&sort=&repeat=1&hasEmail=1&unsubscribed=1&phone=1 (Sprint 5 EP-10.US02.T04, D-107): the
 * store's customers as a CSV file with the same filters and sort as the list: name, phone, email, orders, delivered, total
 * spent, last order, unsubscribed. UTF-8 with a byte order mark (Excel reads Urdu names), quoted cells, and a cell that
 * starts with = + - @ is written as text so it can never run as a spreadsheet formula. At most 5000 rows (header
 * X-Customers-Truncated: 1 when there were more).
 *
 * Order: authenticate -> seller only -> parse (400 with the field) -> assertCan -> DB -> id -> resolveOwnedStoreId -> findOne({ _id, owner }) -> the read.
 *   401 no session   403 an admin, or another seller's store   404 unknown store
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    const query = readQuery(request, customerExportQuerySchema);
    assertCan(ctx.actor, 'read', 'customers');
    const { id } = await context.params;
    const store = await loadOwnedStore(request, ctx, id, 'name owner');
    const file = await exportCustomers(String(store._id), query);
    return new Response(file.csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="customers.csv"',
        'Cache-Control': 'no-store',
        'X-Customers-Row-Cap': String(CUSTOMER_EXPORT_MAX_ROWS),
        ...(file.truncated ? { 'X-Customers-Truncated': '1' } : {}),
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
