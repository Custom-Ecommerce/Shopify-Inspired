import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { readAccountBody } from '@/lib/account-support';
import { authenticate } from '@/lib/auth';
import { BLOCKLIST_MAX, blockedContactRequestSchema } from '@/lib/contracts';
import { toBlockedContactRow } from '@/lib/fraud';
import { HttpError, handleRouteError, isDuplicateKeyError } from '@/lib/http';
import { oid } from '@/lib/ledger-aggregates';
import { loadOwnedStore, requireSellerActor } from '@/lib/owned-store';
import { assertCan, BlockedContact, writeAuditLog } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * GET /api/stores/:id/blocklist (Sprint 5 EP-11.US02.T01, D-107): the phones and emails this store refuses orders from, newest first (at
 * most 500). Seller only, and only of their own store.
 *   200 { docs: [{ id, kind, value, reason, createdAt }], total, limit }   401 no session   403 an admin, or another seller's store
 *
 * Order: authenticate -> seller only -> assertCan -> DB -> id -> resolveOwnedStoreId -> findOne({ _id, owner }) -> the rows of THIS store.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    assertCan(ctx.actor, 'read', 'blockedContacts');
    const { id } = await context.params;
    const store = await loadOwnedStore(request, ctx, id, 'name owner');
    const rows = (await BlockedContact.find({ store: oid(String(store._id)) })
      .sort({ createdAt: -1, _id: -1 })
      .limit(BLOCKLIST_MAX)
      .lean()) as unknown as unknown[];
    const docs = rows.map(toBlockedContactRow);
    return NextResponse.json({ docs, total: docs.length, limit: BLOCKLIST_MAX }, { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * POST /api/stores/:id/blocklist { kind: phone | email, value, reason? } (Sprint 5 EP-11.US02.T01): adds one contact. Strict: an unknown
 * field is refused. The phone is stored as +923xxxxxxxxx (any spelling is accepted) and the email in lower case; a reason is plain
 * text up to 100 characters. At most 500 contacts per store. The audit entry holds the kind only, never the phone, the email or the reason.
 *
 *   201 { contact }                       400 ACCOUNT_BODY_INVALID { field } (kind, value, reason, or an unknown field)
 *   401 no session   403 an admin, or another seller's store
 *   409 BLOCKLIST_EXISTS                  this phone or email is already on the list
 *   422 BLOCKLIST_FULL                    the store already has 500
 *
 * Order: authenticate -> seller only -> parse (400 with the field) -> assertCan -> DB -> id -> resolveOwnedStoreId -> findOne({ _id, owner })
 * -> count -> ONE insert (the unique { store, kind, value } index decides a race) -> best-effort audit.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    const input = await readAccountBody(request, blockedContactRequestSchema);
    assertCan(ctx.actor, 'create', 'blockedContacts', input.reason === '' ? ['kind', 'value'] : ['kind', 'value', 'reason']);
    const { id } = await context.params;
    const store = await loadOwnedStore(request, ctx, id, 'name owner');
    const storeId = String(store._id);

    if ((await BlockedContact.countDocuments({ store: oid(storeId) })) >= BLOCKLIST_MAX) {
      throw new HttpError(422, 'The blocklist is full: remove a contact before adding another (at most ' + BLOCKLIST_MAX + ').', 'BLOCKLIST_FULL', 'value');
    }
    let created: unknown;
    try {
      created = await BlockedContact.create({ store: oid(storeId), kind: input.kind, value: input.value, reason: input.reason, createdBy: ctx.userObjectId });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw new HttpError(409, 'This contact is already on the blocklist.', 'BLOCKLIST_EXISTS', 'value');
      throw err;
    }

    try {
      await writeAuditLog('blocklist.add', 'store', storeId, 'seller:' + ctx.userId, { storeId, kind: input.kind, at: new Date().toISOString() });
    } catch (err) {
      console.error('[seller-backend] could not write the blocklist audit entry', err instanceof Error ? err.name : 'unknown');
    }
    return NextResponse.json({ contact: toBlockedContactRow(created) }, { status: 201, headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}
