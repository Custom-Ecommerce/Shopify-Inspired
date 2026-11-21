import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { getCustomerAddressBook, requireCustomerKey } from '@/lib/customers';
import { HttpError, handleRouteError } from '@/lib/http';
import { loadOwnedStore, requireSellerActor } from '@/lib/owned-store';
import { assertCan } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/stores/:id/customers/:key/addresses (Sprint 5 EP-10.US03.T01, D-107): the customer's address book, seller side only. The
 * distinct delivery addresses taken from their orders (the same trimmed, lower-case address and city count once), newest first, each
 * with how many orders used it and the date it was last used. :key is the same key as the customer detail: the normalized phone (any
 * spelling) or the lower-case email.
 *
 * Order: authenticate -> seller only -> parse the key (400 with the field) -> assertCan -> DB -> id -> resolveOwnedStoreId ->
 * findOne({ _id, owner }) -> the orders of THIS store only.
 *   200 { addresses: [{ address, city, orderCount, lastUsedAt }] }   401 no session   400 a key that is neither a mobile number nor an email
 *   403 an admin, or another seller's store   404 an unknown store, or a key with no order in this store
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string; key: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    const params = await context.params;
    const key = requireCustomerKey(params.key);
    assertCan(ctx.actor, 'read', 'customers');
    const store = await loadOwnedStore(request, ctx, params.id, 'name owner');
    const book = await getCustomerAddressBook(String(store._id), key);
    if (book === null) throw new HttpError(404, 'Customer not found');
    return NextResponse.json(book, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
