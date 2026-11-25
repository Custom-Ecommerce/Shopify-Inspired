import mongoose from 'mongoose';
import { TICKET_CLOSED, TICKET_REVISION_CONFLICT } from '@/lib/contracts';
import { HttpError } from '@/lib/http';
import { ContactMessage, SupportTicket, User } from '@/lib/services';
import { contactToWire, ticketToWire } from '@/lib/support';
import { appendTicketMessage, notifyTicketAdminReply, setTicketStatus, type TicketWrite } from '@/lib/tickets';

/**
 * Sprint 7 (S7-B4): what the admin console reads and writes of the support data. The data lives in the seller database, so the admin backend reaches it by
 * signed internal calls (D-093); the route files are moderationAction wrappers around these functions. The admin console decides WHO may call (the
 * capabilities tickets.read, tickets.reply and contact.read) and writes its own audit entry; this side does the compare-and-set and the email.
 */

const STATUSES = ['open', 'answered', 'closed'];
const CONTACT_STATUSES = ['new', 'read', 'replied', 'closed'];

const notFound = (what: string): HttpError => new HttpError(404, what + ' not found');

function paging(input: { page?: number; limit?: number }): { page: number; limit: number } {
  return { page: input.page ?? 1, limit: Math.min(50, input.limit ?? 20) };
}

interface SellerRef {
  name: string;
  email: string | null;
}

async function sellersByIds(ids: unknown[]): Promise<Map<string, SellerRef>> {
  const unique = [...new Set(ids.map(String))].filter((id) => mongoose.isValidObjectId(id));
  const out = new Map<string, SellerRef>();
  if (unique.length === 0) return out;
  const users = (await User.find({ _id: { $in: unique } } as never).select('name email').lean()) as unknown as Array<{ _id: unknown; name?: unknown; email?: unknown }>;
  for (const u of users) out.set(String(u._id), { name: typeof u.name === 'string' ? u.name : 'Seller', email: typeof u.email === 'string' ? u.email : null });
  return out;
}

/** The tickets of every seller, most recently active first. */
export async function listAdminTickets(input: { status?: string; page?: number; limit?: number }) {
  const { page, limit } = paging(input);
  const filter: Record<string, unknown> = {};
  if (input.status !== undefined && STATUSES.includes(input.status)) filter.status = input.status;
  const [rows, totalDocs] = await Promise.all([
    SupportTicket.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    SupportTicket.countDocuments(filter),
  ]);
  const list = rows as unknown as Array<Record<string, unknown>>;
  const sellers = await sellersByIds(list.map((r) => r.seller));
  const docs = list.map((row) => ({ ...ticketToWire(row, { withMessages: false }), sellerName: sellers.get(String(row.seller))?.name ?? null, sellerEmail: sellers.get(String(row.seller))?.email ?? null }));
  return { docs, page, limit, totalDocs, totalPages: Math.max(1, Math.ceil(totalDocs / limit)) };
}

export async function adminTicketDetail(id: string) {
  if (!mongoose.isValidObjectId(id)) throw notFound('Ticket');
  const row = (await SupportTicket.findOne({ _id: id }).lean()) as unknown as Record<string, unknown> | null;
  if (!row) throw notFound('Ticket');
  const seller = (await sellersByIds([row.seller])).get(String(row.seller));
  return { ticket: { ...ticketToWire(row), sellerName: seller?.name ?? null, sellerEmail: seller?.email ?? null } };
}

function refuse(result: TicketWrite): Record<string, unknown> {
  if (result.kind === 'ok') return result.ticket as Record<string, unknown>;
  if (result.kind === 'not_found') throw notFound('Ticket');
  if (result.kind === 'closed') throw new HttpError(409, 'This ticket is closed.', TICKET_CLOSED);
  throw new HttpError(409, 'This ticket was changed since you opened it. Reload it, then try again.', TICKET_REVISION_CONFLICT);
}

/** The platform answers: a message from the admin, the status becomes answered, and the seller gets one email. */
export async function adminTicketReply(input: { id: string; revision: number; text: string }, adminId: string) {
  if (!mongoose.isValidObjectId(input.id)) throw notFound('Ticket');
  const row = refuse(await appendTicketMessage({}, input.id, input.revision, { from: 'admin', text: input.text, byId: adminId }, 'answered'));
  const wire = ticketToWire(row);
  notifyTicketAdminReply({ id: String(wire.id), seller: String(wire.seller), store: wire.store === null ? null : String(wire.store), subject: String(wire.subject), revision: Number(wire.revision) }, input.text);
  return { ticket: wire };
}

/** An admin moves a ticket between open, answered and closed (compare-and-set on the revision). */
export async function adminTicketStatus(input: { id: string; revision: number; status: 'open' | 'answered' | 'closed' }) {
  if (!mongoose.isValidObjectId(input.id)) throw notFound('Ticket');
  return { ticket: ticketToWire(refuse(await setTicketStatus({}, input.id, input.revision, input.status))) };
}

/** The platform's own contact messages (scope platform). A store's messages are never listed here: they are the seller's. */
export async function listAdminContact(input: { status?: string; page?: number; limit?: number }) {
  const { page, limit } = paging(input);
  const filter: Record<string, unknown> = { scope: 'platform' };
  if (input.status !== undefined && CONTACT_STATUSES.includes(input.status)) filter.status = input.status;
  const [rows, totalDocs] = await Promise.all([
    ContactMessage.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ContactMessage.countDocuments(filter),
  ]);
  const docs = (rows as unknown as Array<Record<string, unknown>>).map((row) => contactToWire(row));
  return { docs, page, limit, totalDocs, totalPages: Math.max(1, Math.ceil(totalDocs / limit)) };
}

export async function adminContactDetail(id: string) {
  if (!mongoose.isValidObjectId(id)) throw notFound('Message');
  const row = await ContactMessage.findOne({ _id: id, scope: 'platform' }).lean();
  if (!row) throw notFound('Message');
  return { message: contactToWire(row) };
}
