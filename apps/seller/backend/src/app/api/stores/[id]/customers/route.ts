import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { listCustomers, readQuery } from '@/lib/broadcast';
import { customerListQuerySchema } from '@/lib/contracts';
import { handleRouteError } from '@/lib/http';
import { loadOwnedStore, requireSellerActor } from '@/lib/owned-store';
import { assertCan } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/stores/:id/customers?page=&limit=&phone=1 (Sprint 4 EP-07.US04, D-092): the store's customers, derived from its
 * orders (there is no customer collection): name, email, phone, order count, last order date and whether the customer
 * unsubscribed from broadcasts. phone=1 keeps only customers with a phone number (the WhatsApp list).
 *
 * Order: authenticate -> seller only -> parse (400 with the field) -> assertCan -> DB -> id -> resolveOwnedStoreId ->
 * findOne({ _id, owner }) -> the read, scoped by that store id.
 *   401 no session   403 an admin, or another seller's store   404 unknown store
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    const query = readQuery(request, customerListQuerySchema);
    assertCan(ctx.actor, 'read', 'customers');
    const { id } = await context.params;
    const store = await loadOwnedStore(request, ctx, id, 'name owner');
    return NextResponse.json(await listCustomers(String(store._id), query), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
