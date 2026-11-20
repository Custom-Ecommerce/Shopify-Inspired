import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { readAccountBody } from '@/lib/account-support';
import { authenticate } from '@/lib/auth';
import { customerNoteRequestSchema } from '@/lib/contracts';
import { customerExists, requireCustomerKey, saveCustomerNote } from '@/lib/customers';
import { HttpError, handleRouteError } from '@/lib/http';
import { loadOwnedStore, requireSellerActor } from '@/lib/owned-store';
import { assertCan, writeAuditLog } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/stores/:id/customers/:key/note { note?, tags? } (Sprint 5 EP-10.US02.T03, D-107): the seller's private note (up to
 * 500 characters) and tags (up to 5, 20 characters each) on a customer of this store. Plain text only (no < or >), strictly
 * validated, unknown fields refused. An empty note clears it. ONE upsert on the unique { store, key }; the answer is what was
 * stored. The audit entry says that a note changed and how many tags there are, and NEVER holds the note text, a tag or the key.
 *
 * Order: authenticate -> seller only -> parse key and body (400 with the field) -> assertCan -> DB -> id -> resolveOwnedStoreId ->
 * findOne({ _id, owner }) -> the customer must have an order in THIS store -> the upsert -> best-effort audit.
 *   200 { note, tags, updatedAt }   401 no session   400 a bad key, note or tags (with the field)
 *   403 an admin, or another seller's store   404 an unknown store, or a customer this store does not have
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string; key: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    const params = await context.params;
    const key = requireCustomerKey(params.key);
    const input = await readAccountBody(request, customerNoteRequestSchema);
    assertCan(
      ctx.actor,
      'update',
      'customerNotes',
      Object.keys(input).filter((field) => (input as Record<string, unknown>)[field] !== undefined),
    );
    const store = await loadOwnedStore(request, ctx, params.id, 'name owner');
    const storeId = String(store._id);
    if (!(await customerExists(storeId, key))) throw new HttpError(404, 'Customer not found');

    const saved = await saveCustomerNote(ctx, storeId, key, input);

    try {
      await writeAuditLog('customer.note', 'store', storeId, 'seller:' + ctx.userId, {
        storeId,
        noteChanged: input.note !== undefined,
        tagCount: saved.tags.length,
      });
    } catch (err) {
      console.error('[seller-backend] could not write the customer note audit entry', err instanceof Error ? err.name : 'unknown');
    }
    return NextResponse.json(saved, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
