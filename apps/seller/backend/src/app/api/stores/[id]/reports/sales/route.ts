import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { readQuery } from '@/lib/broadcast';
import { salesReportQuerySchema } from '@/lib/contracts';
import { handleRouteError } from '@/lib/http';
import { loadOwnedStore, requireSellerActor } from '@/lib/owned-store';
import { resolveReportRange, salesReportResponse } from '@/lib/sales-report';
import { assertCan, ORDER_ACTIONS } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/stores/:id/reports/sales?from&to&status&method (S8-B7, D-118): the store's sales as a CSV download, at most 366 days and 10000 rows (header
 * X-Report-Truncated: 1 and a first note line when there were more). No customer name, phone, email or address. The owner or a member with analytics.read
 * (owner and manager). Every download is audited (who, role, filters, rows, truncated).
 *
 * Order: authenticate -> seller only -> parse (400 with the field) -> assertCan -> DB -> id -> access -> count -> audit -> stream.
 *   401 no session   403 an admin, another store or a role without analytics.read   404 unknown store   503 database or audit
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    const query = readQuery(request, salesReportQuerySchema);
    const range = resolveReportRange(query, new Date());
    assertCan(ctx.actor, ORDER_ACTIONS.view.operation, ORDER_ACTIONS.view.collection);
    const { id } = await context.params;
    const store = await loadOwnedStore(request, ctx, id, 'name owner', 'analytics.read');
    return await salesReportResponse(String(store._id), ctx, query, range);
  } catch (err) {
    return handleRouteError(err);
  }
}
