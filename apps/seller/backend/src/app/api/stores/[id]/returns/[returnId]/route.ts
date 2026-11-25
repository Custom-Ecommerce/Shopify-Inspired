import type { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { authenticate } from '@/lib/auth';
import { handleRouteError } from '@/lib/http';
import { loadOwnedStore, requireSellerActor } from '@/lib/owned-store';
import { readReturn, returnNotFound } from '@/lib/return-actions';
import { json, sellerReturnView } from '@/lib/return-routes';
import { assertCan } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/stores/:id/returns/:returnId (Sprint 5 EP-13.US02.T01): one return of this store, with its lines, what was received, the refunds
 * recorded and the most that can still be refunded.
 *   401 no session   403 an admin, or another seller's store   404 a return that is not in THIS store (another store's id is simply not found)
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string; returnId: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    assertCan(ctx.actor, 'read', 'returns');
    const params = await context.params;
    const store = await loadOwnedStore(request, ctx, params.id, 'name owner', 'returns.read');
    if (!mongoose.isValidObjectId(params.returnId)) throw returnNotFound();
    const doc = await readReturn(String(store._id), params.returnId);
    if (!doc) throw returnNotFound();
    return json(await sellerReturnView(String(store._id), doc));
  } catch (err) {
    return handleRouteError(err);
  }
}
