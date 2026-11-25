import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { TICKET_INVALID, ticketCreateSchema } from '@/lib/contracts';
import { authenticate, auditActorOf } from '@/lib/auth';
import { pageOf, parseSupportBody, ticketToWire } from '@/lib/support';
import { limitTicketWrites, sellerOwnsStore } from '@/lib/tickets';
import { HttpError, handleRouteError, jsonError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan, listEnvelope, SupportTicket, writeAuditLog } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireDatabase(): Promise<void> {
  await connectSellerDb().catch(() => {
    throw new HttpError(503, 'Seller database unavailable');
  });
}

/**
 * GET /api/tickets?status=&page=&limit= (Sprint 7, S7-B4). The seller's OWN support tickets, most recently active first, without their messages. No store header is
 * needed: a ticket belongs to the seller, not to a store.   200 the list envelope   401   403 an admin   422 a bad status
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    if (ctx.actor !== 'seller') throw new HttpError(403, 'Only a seller has support tickets');
    assertCan(ctx.actor, 'read', 'tickets');
    const params = request.nextUrl.searchParams;
    const status = params.get('status');
    if (status !== null && !['open', 'answered', 'closed'].includes(status)) return jsonError(422, 'status must be open, answered or closed');
    const { page, limit } = pageOf(params);
    await requireDatabase();
    const filter: Record<string, unknown> = { seller: ctx.userId };
    if (status !== null) filter.status = status;
    const [rows, totalDocs] = await Promise.all([
      SupportTicket.find(filter)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      SupportTicket.countDocuments(filter),
    ]);
    const docs = (rows as unknown as Record<string, unknown>[]).map((row) => ticketToWire(row, { withMessages: false }));
    return NextResponse.json(listEnvelope(docs, { page, limit, totalDocs }), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * POST /api/tickets (Sprint 7, S7-B4). Body { subject, message, store?, orderRef? } (strict). Opens a ticket from the signed-in seller to the platform. The text is
 * stored as plain text and escaped wherever it is shown. 10 tickets per seller per 10 minutes.
 *
 *   201 the ticket   400 TICKET_INVALID { field }   401   403 an admin, or a store the seller does not own   429
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    if (ctx.actor !== 'seller') throw new HttpError(403, 'Only a seller can open a support ticket');
    const limited = await limitTicketWrites(ctx.userId, request.headers);
    if (limited !== null) return limited;
    const body = await parseSupportBody(request, ticketCreateSchema, TICKET_INVALID);
    assertCan(ctx.actor, 'create', 'tickets', ['subject', 'messages', ...(body.store ? ['store'] : []), ...(body.orderRef ? ['orderRef'] : [])]);
    await requireDatabase();
    if (body.store !== undefined && !(await sellerOwnsStore(ctx.userObjectId, body.store))) throw new HttpError(403, 'Store does not belong to this account');

    const now = new Date();
    const created = (await SupportTicket.create({
      seller: ctx.userId,
      store: body.store ?? null,
      subject: body.subject,
      messages: [{ from: 'seller', text: body.message, at: now, byId: ctx.userId }],
      status: 'open',
      orderRef: body.orderRef ? body.orderRef : null,
      revision: 0,
    })) as unknown;
    const wire = ticketToWire(created);
    try {
      await writeAuditLog('ticket.create', 'ticket', String(wire.id), auditActorOf(ctx), { at: now.toISOString() });
    } catch (err) {
      console.error('[seller-backend] could not write the ticket audit entry', err instanceof Error ? err.message : 'unknown');
    }
    return NextResponse.json(wire, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
