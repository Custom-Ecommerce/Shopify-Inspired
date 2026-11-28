import { NextResponse } from 'next/server';
import { TICKET_CLOSED, TICKET_REVISION_CONFLICT } from '@/lib/contracts';
import { HttpError, tooManyRequests } from '@/lib/http';
import { enqueueEmail, runAfterResponse, sellerDashboardLink } from '@/lib/notifications';
import { pushSupportReply } from '@/lib/push';
import { Store, SupportTicket, User } from '@/lib/services';
import { StorefrontHttpError } from '@/lib/storefront/errors';
import { TICKET_LIMIT, enforceRateLimitFor } from '@/lib/storefront/rate-limit';

/**
 * Sprint 7 (S7-B4): the ticket writes, shared by the seller's routes and the admin's signed calls. Every write is ONE compare-and-set on the revision and
 * names its owner in the filter (`scope`), so a seller can only ever touch their own ticket and an admin call is the only way across sellers.
 */

export type TicketWrite =
  | { kind: 'ok'; ticket: unknown }
  | { kind: 'conflict'; currentRevision: number }
  | { kind: 'not_found' }
  | { kind: 'closed' };

interface StoredTicket {
  status?: unknown;
  revision?: unknown;
}

const revisionFilter = (revision: number): unknown => (revision === 0 ? { $in: [0, null] } : revision);
const revisionOf = (row: StoredTicket | null): number => (row !== null && typeof row.revision === 'number' ? row.revision : 0);

/** A ticket by id inside a scope ({ seller } for a seller, {} for an admin). */
export async function findTicket(scope: Record<string, unknown>, id: string): Promise<unknown | null> {
  return SupportTicket.findOne({ _id: id, ...scope }).lean();
}

/** Adds one message and sets the status, if the ticket is the one the writer read (revision) and is not closed. */
export async function appendTicketMessage(
  scope: Record<string, unknown>,
  id: string,
  revision: number,
  message: { from: 'seller' | 'admin'; text: string; byId: string },
  status: 'open' | 'answered',
): Promise<TicketWrite> {
  const before = (await SupportTicket.findOne({ _id: id, ...scope }).lean()) as unknown as StoredTicket | null;
  if (!before) return { kind: 'not_found' };
  if (before.status === 'closed') return { kind: 'closed' };
  const written = (await SupportTicket.updateOne(
    { _id: id, ...scope, revision: revisionFilter(revision) },
    { $push: { messages: { from: message.from, text: message.text, at: new Date(), byId: message.byId } }, $set: { status }, $inc: { revision: 1 } },
  )) as { matchedCount?: number; n?: number };
  const after = (await SupportTicket.findOne({ _id: id, ...scope }).lean()) as unknown as StoredTicket | null;
  if ((written.matchedCount ?? written.n ?? 0) === 0) return after === null ? { kind: 'not_found' } : { kind: 'conflict', currentRevision: revisionOf(after) };
  return after === null ? { kind: 'not_found' } : { kind: 'ok', ticket: after };
}

/** Sets the status (close, or an admin's open, answered, closed) under the same compare-and-set. */
export async function setTicketStatus(scope: Record<string, unknown>, id: string, revision: number, status: 'open' | 'answered' | 'closed'): Promise<TicketWrite> {
  const before = (await SupportTicket.findOne({ _id: id, ...scope }).lean()) as unknown as StoredTicket | null;
  if (!before) return { kind: 'not_found' };
  const written = (await SupportTicket.updateOne({ _id: id, ...scope, revision: revisionFilter(revision) }, { $set: { status }, $inc: { revision: 1 } })) as { matchedCount?: number; n?: number };
  const after = (await SupportTicket.findOne({ _id: id, ...scope }).lean()) as unknown as StoredTicket | null;
  if ((written.matchedCount ?? written.n ?? 0) === 0) return after === null ? { kind: 'not_found' } : { kind: 'conflict', currentRevision: revisionOf(after) };
  return after === null ? { kind: 'not_found' } : { kind: 'ok', ticket: after };
}

/** The ticket when the write worked; otherwise the refusal as an error the route turns into its 404, 409 TICKET_CLOSED or 409 TICKET_REVISION_CONFLICT. */
export function ticketOrRefusal(result: TicketWrite): unknown | NextResponse {
  if (result.kind === 'ok') return result.ticket;
  if (result.kind === 'not_found') throw new HttpError(404, 'Ticket not found');
  if (result.kind === 'closed') throw new HttpError(409, 'This ticket is closed. Open a new one if you still need help.', TICKET_CLOSED, 'status');
  return NextResponse.json(
    { errors: [{ message: 'This ticket was changed somewhere else. Reload it, then try again.' }], code: TICKET_REVISION_CONFLICT, field: 'revision', currentRevision: result.currentRevision },
    { status: 409, headers: { 'Cache-Control': 'no-store' } },
  );
}

/** The seller's own write limit, on top of the route's session check. A 429 response, or null when the write may go on. */
export async function limitTicketWrites(sellerId: string, headers: Headers): Promise<NextResponse | null> {
  try {
    await enforceRateLimitFor(TICKET_LIMIT, 'tickets', sellerId);
    void headers;
    return null;
  } catch (err) {
    if (err instanceof StorefrontHttpError && err.status === 429) {
      const retry = err.extra.retryAfterSeconds;
      return tooManyRequests(typeof retry === 'number' ? retry : 60);
    }
    throw err;
  }
}

/** Whether a store id belongs to the seller (a ticket may name one of their stores). */
export async function sellerOwnsStore(sellerObjectId: unknown, storeId: string): Promise<boolean> {
  return Boolean(await Store.exists({ _id: storeId, owner: sellerObjectId } as never));
}

/** The seller's name and email, for the admin's inbox and the email after a reply. */
export async function sellerInfoOf(sellerId: unknown): Promise<{ name: string; email: string | null } | null> {
  const user = (await User.findById(sellerId as never).select('name email').lean()) as { name?: unknown; email?: unknown } | null;
  if (!user) return null;
  return { name: typeof user.name === 'string' && user.name !== '' ? user.name : 'Seller', email: typeof user.email === 'string' && user.email !== '' ? user.email : null };
}

/** After the platform answers: one email to the seller (key ticket_reply:<id>:<revision>). Best effort. */
export async function sendTicketAdminReply(ticket: { id: string; seller: string; store: string | null; subject: string; revision: number }, text: string): Promise<void> {
  const seller = await sellerInfoOf(ticket.seller);
  if (seller === null || seller.email === null) return;
  const firstStore = ticket.store ?? String(((await Store.findOne({ owner: ticket.seller } as never).select('_id').sort({ createdAt: 1 }).lean()) as { _id?: unknown } | null)?._id ?? '');
  const link = firstStore === '' ? null : sellerDashboardLink(firstStore, '/support/' + ticket.id);
  await enqueueEmail({
    template: 'ticket_admin_reply',
    to: seller.email,
    vars: { customerName: seller.name, ticketSubject: ticket.subject, replyText: text.length > 3000 ? text.slice(0, 3000) : text, dashboardLink: link ?? 'your Markazify dashboard (Support)' },
    dedupeKey: 'ticket_reply:' + ticket.id + ':' + ticket.revision,
  });
}

export function notifyTicketAdminReply(ticket: { id: string; seller: string; store: string | null; subject: string; revision: number }, text: string): void {
  runAfterResponse('ticket_admin_reply', () => sendTicketAdminReply(ticket, text));
  runAfterResponse('push_support_reply', async () => void (await pushSupportReply(ticket.seller, ticket.id, ticket.revision)));
}
