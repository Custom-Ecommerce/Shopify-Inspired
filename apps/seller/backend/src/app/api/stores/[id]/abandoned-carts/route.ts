import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { listCarts } from '@/lib/abandoned-carts';
import { authenticate } from '@/lib/auth';
import { readQuery } from '@/lib/broadcast';
import { abandonedCartListQuerySchema } from '@/lib/contracts';
import { handleRouteError } from '@/lib/http';
import { loadOwnedStore, requireSellerActor } from '@/lib/owned-store';
import { assertCan } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/stores/:id/abandoned-carts?status=open|contacted|recovered&page=&limit= (Sprint 5 EP-28.US01.T04, D-107): the carts shoppers left in
 * THIS store, newest activity first (at most 50 per page), with the store's count of open carts. A cart past its 7 days is not listed. Each cart
 * has the phone (the seller messages it), the items as the server priced them, the value, and its state. Seller only, of their own store.
 *   200 { docs, page, limit, totalDocs, totalPages, openCount }   400 ACCOUNT_BODY_INVALID { field }   401   403 an admin, or another seller's store
 *
 * Order: authenticate -> seller only -> parse the query (400 with the field) -> assertCan -> DB -> id -> resolveOwnedStoreId -> findOne({ _id, owner })
 * -> the carts of THIS store.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    const query = readQuery(request, abandonedCartListQuerySchema);
    assertCan(ctx.actor, 'read', 'abandonedCarts');
    const { id } = await context.params;
    const store = await loadOwnedStore(request, ctx, id, 'name owner', 'abandoned_carts.manage');
    return NextResponse.json(await listCarts(String(store._id), query), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
