import mongoose from 'mongoose';
import { adminDeviceDetails, AdminHttpError } from '@/lib/admin-auth';
import { readAdminBody } from '@/lib/admin-account';
import { contactListQuerySchema, ticketListQuerySchema, ticketReplySchema, ticketStatusUpdateSchema } from '@/lib/admin-support-contracts';
import { readAdminQuery } from '@/lib/admin-payouts';
import { NO_STORE } from '@/lib/admin-session';
import { listPlatformContact, listSupportTickets, readPlatformContact, readSupportTicket, replySupportTicket, setSupportTicketStatus } from '@/lib/seller-moderation-client';
import { writeAuditLog } from '@/lib/workspace';

/**
 * Sprint 7 (S7-B4, D-093): the admin console's support inbox. The tickets and the platform's contact messages live in the SELLER database, so every call is one
 * signed call to the seller backend (seller-moderation-client.ts). What this backend adds is the capability check (the route files: tickets.read, tickets.reply,
 * contact.read) and the ADMIN audit entry for a reply and for a status change. The seller backend does the compare-and-set on the revision and emails the
 * seller on a reply. A message a seller or a shopper typed is plain text here: this layer never turns it into markup.
 *
 * Capabilities (packages/auth admin-levels): tickets.read, tickets.reply and contact.read belong to owner and customer_support; finance and operations hold none.
 */
export const supportSteps = {
  listTickets: listSupportTickets,
  readTicket: readSupportTicket,
  reply: replySupportTicket,
  setStatus: setSupportTicketStatus,
  listContact: listPlatformContact,
  readContact: readPlatformContact,
  audit: writeAuditLog as unknown as (action: string, entity: string, entityId: string, actorId: string, details: Record<string, unknown>) => Promise<unknown>,
};

const notFound = (what: string): AdminHttpError => new AdminHttpError(404, what + ' not found');

async function auditQuietly(action: string, entity: string, entityId: string, adminId: string, details: Record<string, unknown>): Promise<void> {
  try {
    await supportSteps.audit(action, entity, entityId, adminId, { ...details, at: new Date().toISOString() });
  } catch (err) {
    console.error('[admin-backend] could not write a support audit entry', { action, error: err instanceof Error ? err.message.slice(0, 200) : 'unknown' });
  }
}

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/admin/tickets?status&page&limit */
export async function listTicketsFor(request: Request, userId: string): Promise<Response> {
  const query = readAdminQuery(request, ticketListQuerySchema);
  return Response.json(await supportSteps.listTickets(userId, query), { status: 200, headers: NO_STORE });
}

/** GET /api/admin/tickets/:id */
export async function readTicketFor(_request: Request, context: Ctx, userId: string): Promise<Response> {
  const { id } = await context.params;
  if (!mongoose.isValidObjectId(id)) throw notFound('Ticket');
  return Response.json(await supportSteps.readTicket(userId, id), { status: 200, headers: NO_STORE });
}

/** POST /api/admin/tickets/:id/reply { revision, text }. The seller backend writes the message and emails the seller; the audit entry holds the ids, never the text. */
export async function replyTicketFor(request: Request, context: Ctx, userId: string): Promise<Response> {
  const { id } = await context.params;
  if (!mongoose.isValidObjectId(id)) throw notFound('Ticket');
  const body = await readAdminBody(request, ticketReplySchema);
  const answer = await supportSteps.reply(userId, { id, revision: body.revision, text: body.text });
  await auditQuietly('ticket.reply', 'ticket', id, userId, { revision: body.revision + 1, length: body.text.length, ...adminDeviceDetails(request) });
  return Response.json(answer, { status: 200, headers: NO_STORE });
}

/** POST /api/admin/tickets/:id/status { revision, status } (open, answered or closed). */
export async function statusTicketFor(request: Request, context: Ctx, userId: string): Promise<Response> {
  const { id } = await context.params;
  if (!mongoose.isValidObjectId(id)) throw notFound('Ticket');
  const body = await readAdminBody(request, ticketStatusUpdateSchema);
  const answer = await supportSteps.setStatus(userId, { id, revision: body.revision, status: body.status });
  await auditQuietly('ticket.status', 'ticket', id, userId, { status: body.status, revision: body.revision + 1, ...adminDeviceDetails(request) });
  return Response.json(answer, { status: 200, headers: NO_STORE });
}

/** GET /api/admin/contact-messages?status&page&limit: the PLATFORM contact messages only. */
export async function listContactFor(request: Request, userId: string): Promise<Response> {
  const query = readAdminQuery(request, contactListQuerySchema);
  return Response.json(await supportSteps.listContact(userId, query), { status: 200, headers: NO_STORE });
}

/** GET /api/admin/contact-messages/:id */
export async function readContactFor(_request: Request, context: Ctx, userId: string): Promise<Response> {
  const { id } = await context.params;
  if (!mongoose.isValidObjectId(id)) throw notFound('Message');
  return Response.json(await supportSteps.readContact(userId, id), { status: 200, headers: NO_STORE });
}
