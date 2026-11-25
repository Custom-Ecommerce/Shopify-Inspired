import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { TICKET_INVALID, ticketReplySchema } from '@/lib/contracts';
import { authenticate, auditActorOf } from '@/lib/auth';
import { parseSupportBody, ticketToWire } from '@/lib/support';
import { appendTicketMessage, limitTicketWrites, ticketOrRefusal } from '@/lib/tickets';
import { HttpError, handleRouteError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan, writeAuditLog } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/tickets/:id/reply (Sprint 7, S7-B4). Body { revision, text }. The seller adds a message to their OWN open ticket; the status goes back to open (the
 * platform has something to read). ONE compare-and-set on the revision.
 *   200 the ticket   400 TICKET_INVALID { field }   401   403   404 not theirs   409 TICKET_REVISION_CONFLICT   409 TICKET_CLOSED   429
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    if (ctx.actor !== 'seller') throw new HttpError(403, 'Only a seller has support tickets');
    const limited = await limitTicketWrites(ctx.userId, request.headers);
    if (limited !== null) return limited;
    const body = await parseSupportBody(request, ticketReplySchema, TICKET_INVALID);
    assertCan(ctx.actor, 'update', 'tickets', ['messages', 'status']);
    const { id } = await context.params;
    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Ticket not found');
    const result = ticketOrRefusal(await appendTicketMessage({ seller: ctx.userId }, id, body.revision, { from: 'seller', text: body.text, byId: ctx.userId }, 'open'));
    if (result instanceof NextResponse) return result;
    try {
      await writeAuditLog('ticket.reply', 'ticket', id, auditActorOf(ctx), { at: new Date().toISOString() });
    } catch (err) {
      console.error('[seller-backend] could not write the ticket audit entry', err instanceof Error ? err.message : 'unknown');
    }
    return NextResponse.json(ticketToWire(result, { forSeller: true }), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
