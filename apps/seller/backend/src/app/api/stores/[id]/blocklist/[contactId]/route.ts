import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { authenticate, auditActorOf } from '@/lib/auth';
import { HttpError, handleRouteError } from '@/lib/http';
import { oid } from '@/lib/ledger-aggregates';
import { loadOwnedStore, requireSellerActor } from '@/lib/owned-store';
import { assertCan, BlockedContact, writeAuditLog } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DELETE /api/stores/:id/blocklist/:contactId (Sprint 5 EP-11.US02.T01, D-107): takes one contact off this store's blocklist. The delete
 * is ONE findOneAndDelete on { _id, store }, so another store's contact id is simply not found. The audit entry holds the kind only.
 *
 *   200 { removed: true, id }   401 no session   403 an admin, or another seller's store
 *   404 an id that is not on THIS store's list (a malformed id, an unknown one, or another store's)
 *
 * Order: authenticate -> seller only -> assertCan -> DB -> id -> resolveOwnedStoreId -> findOne({ _id, owner }) -> the one delete -> audit.
 */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string; contactId: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    assertCan(ctx.actor, 'delete', 'blockedContacts');
    const params = await context.params;
    const store = await loadOwnedStore(request, ctx, params.id, 'name owner', 'blocklist.manage');
    const storeId = String(store._id);
    if (!mongoose.isValidObjectId(params.contactId)) throw new HttpError(404, 'Contact not found');

    const removed = (await BlockedContact.findOneAndDelete({ _id: params.contactId, store: oid(storeId) }).lean()) as unknown as { kind?: string } | null;
    if (!removed) throw new HttpError(404, 'Contact not found');

    try {
      await writeAuditLog('blocklist.remove', 'store', storeId, auditActorOf(ctx), { storeId, kind: removed.kind ?? null, at: new Date().toISOString() });
    } catch (err) {
      console.error('[seller-backend] could not write the blocklist audit entry', err instanceof Error ? err.name : 'unknown');
    }
    return NextResponse.json({ removed: true, id: params.contactId }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
