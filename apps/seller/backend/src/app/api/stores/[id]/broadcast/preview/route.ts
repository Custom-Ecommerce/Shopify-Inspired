import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { readAccountBody } from '@/lib/account-support';
import { authenticate } from '@/lib/auth';
import { previewBroadcast } from '@/lib/broadcast';
import { broadcastPreviewRequestSchema } from '@/lib/contracts';
import { handleRouteError } from '@/lib/http';
import { loadOwnedStore, requireSellerActor } from '@/lib/owned-store';
import { assertCan } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/stores/:id/broadcast/preview { subject, message } (Sprint 4 EP-07.US04): checks the text (plain text, subject
 * up to 120, message up to 2000) and answers how many customers would receive it: those with an email who have not
 * unsubscribed, never more than the cap of 500 ({ recipientCount, cap, tooLarge }). Nothing is saved or sent.
 *   400 a bad subject or message (with the field)   401   403 an admin, or another seller's store   404
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    await readAccountBody(request, broadcastPreviewRequestSchema);
    assertCan(ctx.actor, 'read', 'broadcasts');
    const { id } = await context.params;
    const store = await loadOwnedStore(request, ctx, id, 'name owner', 'broadcast.manage');
    return NextResponse.json(await previewBroadcast(String(store._id)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
