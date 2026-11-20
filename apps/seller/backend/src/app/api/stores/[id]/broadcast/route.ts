import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { readAccountBody, requireVerifiedEmail } from '@/lib/account-support';
import { authenticate } from '@/lib/auth';
import { createBroadcast, listBroadcasts, readQuery } from '@/lib/broadcast';
import { broadcastListQuerySchema, createBroadcastRequestSchema } from '@/lib/contracts';
import { handleRouteError } from '@/lib/http';
import { loadOwnedStore, requireSellerActor } from '@/lib/owned-store';
import { assertCan } from '@/lib/services';
import { readMessages } from '@/lib/store-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/stores/:id/broadcast?page=&limit= (Sprint 4 EP-07.US04, D-092): the store's broadcast history, newest first, each
 * with the outcome counts of its emails (queued, sent, failed, skipped), counted from the outbox rows of that broadcast.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    const query = readQuery(request, broadcastListQuerySchema);
    assertCan(ctx.actor, 'read', 'broadcasts');
    const { id } = await context.params;
    const store = await loadOwnedStore(request, ctx, id, 'name owner');
    return NextResponse.json(await listBroadcasts(String(store._id), query), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * POST /api/stores/:id/broadcast { subject, message, expectedCount } (Sprint 4 EP-07.US04, D-092): emails every customer with
 * an address who has not unsubscribed. The recipients are queued in the outbox without sending (the flush route sends them
 * in batches), each with a signed unsubscribe link.
 *
 *   201 the broadcast with its counts
 *   400 a bad subject, message or expectedCount (with the field)   401   404 unknown store
 *   403 an admin, another seller's store, or EMAIL_NOT_VERIFIED (the seller's own email)
 *   409 BROADCAST_COUNT_CHANGED   422 BROADCAST_TOO_LARGE (over 500) | BROADCAST_NO_RECIPIENTS
 *   429 BROADCAST_DAILY_LIMIT (one per store per Asia/Karachi day)
 *   503 BROADCAST_NOT_CONFIGURED (UNSUBSCRIBE_SIGNING_SECRET missing or shorter than 16 characters)
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    const input = await readAccountBody(request, createBroadcastRequestSchema);
    assertCan(ctx.actor, 'create', 'broadcasts');
    const { id } = await context.params;
    const store = await loadOwnedStore(request, ctx, id, 'name owner storefront');
    await requireVerifiedEmail(ctx);
    const row = await createBroadcast(ctx, { id: String(store._id), name: String(store.name ?? 'Your store'), footer: readMessages(store.storefront).emailFooter }, input);
    return NextResponse.json(row, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
