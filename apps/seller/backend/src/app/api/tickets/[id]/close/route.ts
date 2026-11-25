import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { TICKET_INVALID, ticketCloseSchema } from '@/lib/contracts';
import { authenticate, auditActorOf } from '@/lib/auth';
import { parseSupportBody, ticketToWire } from '@/lib/support';
import { setTicketStatus, ticketOrRefusal } from '@/lib/tickets';
import { HttpError, handleRouteError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan, writeAuditLog } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/tickets/:id/close (Sprint 7, S7-B4). Body { revision }. The seller closes their OWN ticket (ONE compare-and-set on the revision). A closed ticket is
 * kept for 730 days and then purged.   200 the ticket   400   401   403   404 not theirs   409 TICKET_REVISION_CONFLICT
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    if (ctx.actor !== 'seller') throw new HttpError(403, 'Only a seller has support tickets');
    const body = await parseSupportBody(request, ticketCloseSchema, TICKET_INVALID);
    assertCan(ctx.actor, 'update', 'tickets', ['status']);
    const { id } = await context.params;
    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Ticket not found');
    const result = ticketOrRefusal(await setTicketStatus({ seller: ctx.userId }, id, body.revision, 'closed'));
    if (result instanceof NextResponse) return result;
    try {
      await writeAuditLog('ticket.close', 'ticket', id, auditActorOf(ctx), { at: new Date().toISOString() });
    } catch (err) {
      console.error('[seller-backend] could not write the ticket audit entry', err instanceof Error ? err.message : 'unknown');
    }
    return NextResponse.json(ticketToWire(result, { forSeller: true }), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
