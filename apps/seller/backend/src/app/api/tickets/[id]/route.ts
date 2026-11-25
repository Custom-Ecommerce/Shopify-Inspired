import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { authenticate } from '@/lib/auth';
import { ticketToWire } from '@/lib/support';
import { findTicket } from '@/lib/tickets';
import { HttpError, handleRouteError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/tickets/:id (Sprint 7, S7-B4). One of the seller's OWN tickets with its messages (plain text). Another seller's ticket, and an unknown or malformed id, are the same 404. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    if (ctx.actor !== 'seller') throw new HttpError(403, 'Only a seller has support tickets');
    assertCan(ctx.actor, 'read', 'tickets');
    const { id } = await context.params;
    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Ticket not found');
    const doc = await findTicket({ seller: ctx.userId }, id);
    if (!doc) throw new HttpError(404, 'Ticket not found');
    return NextResponse.json(ticketToWire(doc, { forSeller: true }), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
