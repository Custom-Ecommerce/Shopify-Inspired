import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { CONTACT_REVISION_CONFLICT, CONTACT_INVALID, contactStatusUpdateSchema } from '@/lib/contracts';
import { authenticate, auditActorOf } from '@/lib/auth';
import { contactToWire, parseSupportBody } from '@/lib/support';
import { HttpError, handleRouteError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan, ContactMessage, writeAuditLog } from '@/lib/services';
import { resolveOwnedStoreId } from '@/lib/data-plane';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const notFound = (): HttpError => new HttpError(404, 'Message not found');

async function requireDatabase(): Promise<void> {
  await connectSellerDb().catch(() => {
    throw new HttpError(503, 'Seller database unavailable');
  });
}

interface StoredContact {
  status?: unknown;
  revision?: unknown;
}

/** GET /api/contactMessages/:id. Another store's message (and any platform message) answers 404. */
export async function GET(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    if (ctx.actor !== 'seller') throw new HttpError(403, 'Only the store owner can read its inbox');
    assertCan(ctx.actor, 'read', 'contactMessages');
    const { id } = await context.params;
    await requireDatabase();
    if (!mongoose.isValidObjectId(id)) throw notFound();
    const storeId = await resolveOwnedStoreId(request, ctx, null, { capability: 'contact.read' });
    const doc = await ContactMessage.findOne({ _id: id, scope: 'store', store: storeId }).lean();
    if (!doc) throw notFound();
    return NextResponse.json(contactToWire(doc), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * PATCH /api/contactMessages/:id (Sprint 7, S7-B4). Body { revision, status: 'read' | 'closed' }: marks a message read or closes it. Replying is its own route.
 *
 *   200 the message   400 CONTACT_INVALID { field }   401   403   404 bad id, unknown, another store's   409 CONTACT_REVISION_CONFLICT { currentRevision }
 *
 * Order: authenticate, role, parse, assertCan, DB, id, store (requireStore), findOne({ _id, scope, store }), ONE compare-and-set write on the revision, re-read,
 * best-effort audit. Marking read is idempotent: a message that is no longer new is returned as it is (no write, so it never moves back from replied or closed).
 */
export async function PATCH(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    if (ctx.actor !== 'seller') throw new HttpError(403, 'Only the store owner can change its inbox');
    const body = await parseSupportBody(request, contactStatusUpdateSchema, CONTACT_INVALID);
    assertCan(ctx.actor, 'update', 'contactMessages', ['status']);
    const { id } = await context.params;
    await requireDatabase();
    if (!mongoose.isValidObjectId(id)) throw notFound();
    const storeId = await resolveOwnedStoreId(request, ctx, null, { requireStore: true, capability: 'contact.write' });

    const before = (await ContactMessage.findOne({ _id: id, scope: 'store', store: storeId }).lean()) as unknown as StoredContact | null;
    if (!before) throw notFound();
    if (body.status === 'read' && before.status !== 'new') return NextResponse.json(contactToWire(before), { headers: { 'Cache-Control': 'no-store' } });
    if (body.status === 'closed' && before.status === 'closed') return NextResponse.json(contactToWire(before), { headers: { 'Cache-Control': 'no-store' } });

    const written = (await ContactMessage.updateOne(
      { _id: id, scope: 'store', store: storeId, revision: body.revision === 0 ? { $in: [0, null] } : body.revision },
      { $set: { status: body.status }, $inc: { revision: 1 } },
    )) as { matchedCount?: number; n?: number };
    const after = (await ContactMessage.findOne({ _id: id, scope: 'store', store: storeId }).lean()) as unknown as StoredContact | null;
    if ((written.matchedCount ?? written.n ?? 0) === 0) {
      if (!after) throw notFound();
      return NextResponse.json(
        { errors: [{ message: 'This message was changed somewhere else. Reload it, then try again.' }], code: CONTACT_REVISION_CONFLICT, field: 'revision', currentRevision: typeof after.revision === 'number' ? after.revision : 0 },
        { status: 409, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (!after) throw notFound();
    try {
      await writeAuditLog('contact.' + body.status, 'contactMessage', id, auditActorOf(ctx), { storeId, at: new Date().toISOString() });
    } catch (err) {
      console.error('[seller-backend] could not write the contact audit entry', err instanceof Error ? err.message : 'unknown');
    }
    return NextResponse.json(contactToWire(after), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
