import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import type { SellerReturn } from '@markaz/contracts';
import { readAccountBody } from '@/lib/account-support';
import { authenticate, type AuthContext } from '@/lib/auth';
import { HttpError } from '@/lib/http';
import { loadOwnedStore, requireSellerActor } from '@/lib/owned-store';
import { readOrderOf, returnNotFound, type Actor } from '@/lib/return-actions';
import { refundCapFor, toSellerReturn } from '@/lib/returns';
import { Return, assertCan } from '@/lib/services';

/*
 * Sprint 5 EP-13.US02 (D-107): the preamble every seller return route shares, in the standard order:
 *   authenticate -> seller only -> parse the body (400 with the field) -> assertCan -> DB -> id -> resolveOwnedStoreId -> the store
 * and then the route reads findOne({ _id, store }) itself. A foreign store id is 403, a foreign return id is 404.
 */

export const NO_STORE = { 'Cache-Control': 'no-store' };

interface BodySchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> } };
}

export interface ReturnRouteContext {
  ctx: AuthContext;
  storeId: string;
  storeName: string;
  returnId: string;
  actor: Actor;
}

/** Runs the standard steps. `schema` is the action's strict body schema; `fields` the keys the policy row returnActions is asked about. */
export async function prepareReturnRoute<T>(
  request: NextRequest,
  params: { id: string; returnId: string },
  action: { schema: BodySchema<T>; fields: (body: T) => string[] },
): Promise<{ route: ReturnRouteContext; body: T }> {
  const ctx = await authenticate(request);
  requireSellerActor(ctx);
  const body = await readAccountBody(request, action.schema);
  assertCan(ctx.actor, 'update', 'returnActions', action.fields(body));
  const store = await loadOwnedStore(request, ctx, params.id, 'name owner');
  if (!mongoose.isValidObjectId(params.returnId)) throw returnNotFound();
  return {
    body,
    route: {
      ctx,
      storeId: String(store._id),
      storeName: typeof store.name === 'string' ? store.name : '',
      returnId: params.returnId,
      actor: { userObjectId: ctx.userObjectId, auditActor: 'seller:' + ctx.userId },
    },
  };
}

/** The same steps for the actions that take no body (approve). */
export async function prepareReturnRouteNoBody(request: NextRequest, params: { id: string; returnId: string }): Promise<ReturnRouteContext> {
  const ctx = await authenticate(request);
  requireSellerActor(ctx);
  // An action with no body still needs a role check on the policy row; the first field is the one every action row allows.
  assertCan(ctx.actor, 'update', 'returnActions', ['reason']);
  const store = await loadOwnedStore(request, ctx, params.id, 'name owner');
  if (!mongoose.isValidObjectId(params.returnId)) throw returnNotFound();
  return {
    ctx,
    storeId: String(store._id),
    storeName: typeof store.name === 'string' ? store.name : '',
    returnId: params.returnId,
    actor: { userObjectId: ctx.userObjectId, auditActor: 'seller:' + ctx.userId },
  };
}

/** The seller's view of a return with what the order adds (the payment method, the customer's name, the refund cap). */
export async function sellerReturnView(storeId: string, doc: Record<string, unknown>, knownOrder?: Record<string, unknown> | null): Promise<SellerReturn> {
  const order = knownOrder === undefined ? await readOrderOf(storeId, doc) : knownOrder;
  // The cap follows the rule of the whole order (SB-6): the return that completes the received quantities takes the order base minus the earlier ones.
  const counted = doc.status === 'received' || doc.status === 'refunded';
  const siblings = order && counted ? ((await Return.find({ store: storeId, order: doc.order, status: { $in: ['received', 'refunded'] } }).lean()) as unknown as Record<string, unknown>[]) : [];
  return toSellerReturn(doc, {
    paymentMethod: typeof order?.paymentMethod === 'string' ? order.paymentMethod : null,
    customerName: typeof order?.customerName === 'string' ? order.customerName : null,
    refundCap: order ? refundCapFor(doc, order, siblings) : null,
  });
}

export const json = (body: unknown, status = 200): NextResponse => NextResponse.json(body, { status, headers: NO_STORE });

export { HttpError };
