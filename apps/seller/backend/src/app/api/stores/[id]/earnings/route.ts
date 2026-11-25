import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { ACCOUNT_CODES, earningsQuerySchema } from '@/lib/contracts';
import { buildEarnings } from '@/lib/earnings';
import { HttpError, handleRouteError } from '@/lib/http';
import { loadOwnedStore, requireSellerActor } from '@/lib/owned-store';
import { assertCan } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/stores/:id/earnings?period=today|7|30|90|custom&from=YYYY-MM-DD&to=YYYY-MM-DD&page=&limit=&type=
 * (Sprint 4 EP-05.US04, D-090): the seller's own earnings of one store, from the commission ledger only.
 *
 * Periods are Asia/Karachi days: the start is included and the end is not; for custom, both days named are included.
 *
 *   200 { period, summary: { sales, commission, net }, allTime: { balance, totalPaidOut }, entries, payouts }
 *       all whole rupees; an empty store answers zeros and empty lists
 *   400 a bad period, date, page or type (with the field)   401 no session
 *   403 an admin session or another seller's store   404 unknown store
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    const parsed = earningsQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const unknownKey = issue?.code === 'unrecognized_keys' && 'keys' in issue && Array.isArray(issue.keys) ? issue.keys[0] : undefined;
      const field = unknownKey !== undefined ? String(unknownKey) : issue && issue.path.length > 0 ? issue.path.map(String).join('.') : 'query';
      throw new HttpError(400, issue?.message ?? 'Invalid request', ACCOUNT_CODES.BODY_INVALID, field);
    }
    assertCan(ctx.actor, 'read', 'earnings');
    assertCan(ctx.actor, 'read', 'payouts', ['amount', 'method', 'reference', 'status', 'createdAt']);
    const { id } = await context.params;
    const store = await loadOwnedStore(request, ctx, id, 'name owner', 'earnings.read');
    return NextResponse.json(await buildEarnings(String(store._id), parsed.data), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
