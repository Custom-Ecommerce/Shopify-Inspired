import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { getCustomerDetail, requireCustomerKey } from '@/lib/customers';
import { HttpError, handleRouteError } from '@/lib/http';
import { loadOwnedStore, requireSellerActor } from '@/lib/owned-store';
import { assertCan } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/stores/:id/customers/:key (Sprint 5 EP-10.US02.T02, D-107): one customer of the store. :key is the normalized phone
 * (+923xxxxxxxxx, any spelling of it) or, for a customer with no phone, the lower-case email: the `id` of a list row. The answer
 * holds the statistics, the seller's note and tags, the customer's orders newest first (number, date, status, total, payment)
 * and the distinct delivery addresses.
 *
 * Order: authenticate -> seller only -> parse the key (400 with the field) -> assertCan -> DB -> id -> resolveOwnedStoreId ->
 * findOne({ _id, owner }) -> the customer, found only among THIS store's orders.
 *   401 no session   400 a key that is neither a mobile number nor an email   403 an admin, or another seller's store
 *   404 an unknown store, or a key with no order in this store (another store's customer is simply not found)
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string; key: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    const params = await context.params;
    const key = requireCustomerKey(params.key);
    assertCan(ctx.actor, 'read', 'customers');
    const store = await loadOwnedStore(request, ctx, params.id, 'name owner', 'customers.read');
    const detail = await getCustomerDetail(String(store._id), key);
    if (detail === null) throw new HttpError(404, 'Customer not found');
    return NextResponse.json(detail, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
