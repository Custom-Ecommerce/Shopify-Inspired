import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { CONTACT_INVALID, CONTACT_REVISION_CONFLICT, contactReplySchema } from '@/lib/contracts';
import { authenticate } from '@/lib/auth';
import { notifyContactReply } from '@/lib/contact';
import { contactToWire, parseSupportBody, whatsappLink } from '@/lib/support';
import { HttpError, handleRouteError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan, ContactMessage, writeAuditLog } from '@/lib/services';
import { resolveOwnedStoreId } from '@/lib/data-plane';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface StoredContact {
  _id: unknown;
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  status?: unknown;
  revision?: unknown;
}

/**
 * POST /api/contactMessages/:id/reply (Sprint 7, S7-B4). Body { revision, text }. The reply is kept on the message and the status becomes replied.
 * By EMAIL (through the notification outbox) when the shopper gave an email; otherwise the answer carries `whatsappLink`, a wa.me link to the shopper's number
 * with the reply as the prefilled text, and the reply is recorded with the whatsapp channel.
 *
 *   200 { message, channel, whatsappLink }   400 CONTACT_INVALID { field }   401   403   404 bad id, unknown, another store's
 *   409 CONTACT_REVISION_CONFLICT   409 CONTACT_CLOSED (a closed message is not answered)
 *
 * Order: authenticate, role, parse, assertCan, DB, id, store (requireStore), findOne, ONE compare-and-set write ($push the reply, $set the status, $inc the
 * revision), re-read, audit, then the email after the response.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    if (ctx.actor !== 'seller') throw new HttpError(403, 'Only the store owner can answer its inbox');
    const body = await parseSupportBody(request, contactReplySchema, CONTACT_INVALID);
    assertCan(ctx.actor, 'update', 'contactMessages', ['status', 'replies']);
    const { id } = await context.params;
    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Message not found');
    const storeId = await resolveOwnedStoreId(request, ctx, null, { requireStore: true });

    const before = (await ContactMessage.findOne({ _id: id, scope: 'store', store: storeId }).lean()) as unknown as StoredContact | null;
    if (!before) throw new HttpError(404, 'Message not found');
    if (before.status === 'closed') throw new HttpError(409, 'This message is closed. Nobody can answer it any more.', 'CONTACT_CLOSED', 'status');

    const email = typeof before.email === 'string' ? before.email : '';
    const channel = email !== '' ? 'email' : 'whatsapp';
    const link = channel === 'whatsapp' ? whatsappLink(before.phone, body.text) : null;
    if (channel === 'whatsapp' && link === null) throw new HttpError(409, 'This shopper left no email and no usable phone number, so there is nowhere to send an answer.', 'CONTACT_NO_ADDRESS', 'text');

    const written = (await ContactMessage.updateOne(
      { _id: id, scope: 'store', store: storeId, revision: body.revision === 0 ? { $in: [0, null] } : body.revision },
      { $push: { replies: { text: body.text, at: new Date(), by: ctx.userId, channel } }, $set: { status: 'replied' }, $inc: { revision: 1 } },
    )) as { matchedCount?: number; n?: number };
    const after = (await ContactMessage.findOne({ _id: id, scope: 'store', store: storeId }).lean()) as unknown as StoredContact | null;
    if ((written.matchedCount ?? written.n ?? 0) === 0) {
      if (!after) throw new HttpError(404, 'Message not found');
      return NextResponse.json(
        { errors: [{ message: 'This message was changed somewhere else. Reload it, then answer again.' }], code: CONTACT_REVISION_CONFLICT, field: 'revision', currentRevision: typeof after.revision === 'number' ? after.revision : 0 },
        { status: 409, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (!after) throw new HttpError(404, 'Message not found');

    try {
      await writeAuditLog('contact.reply', 'contactMessage', id, 'seller:' + ctx.userId, { storeId, channel, at: new Date().toISOString() });
    } catch (err) {
      console.error('[seller-backend] could not write the contact audit entry', err instanceof Error ? err.message : 'unknown');
    }
    if (channel === 'email') notifyContactReply(storeId, { id, name: String(before.name ?? ''), email }, body.text, body.revision + 1);
    return NextResponse.json({ message: contactToWire(after), channel, whatsappLink: link }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
