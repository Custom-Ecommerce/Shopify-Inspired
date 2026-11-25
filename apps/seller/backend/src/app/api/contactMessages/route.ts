import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { CONTACT_STATUSES_LIST } from '@/lib/contact-statuses';
import { authenticate } from '@/lib/auth';
import { pageOf, contactToWire } from '@/lib/support';
import { HttpError, handleRouteError, jsonError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan, ContactMessage, listEnvelope } from '@/lib/services';
import { resolveOwnedStoreId } from '@/lib/data-plane';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/contactMessages?status=&page=&limit= (Sprint 7, S7-B4). The inbox of the verified store: the store's own messages, newest first. Never another store's
 * (and never a platform message). `status=new&limit=1` is the unread count (totalDocs), for the navigation.
 *
 *   200 the list envelope   401   403 an admin, or a store the seller does not own   422 a bad status
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    if (ctx.actor !== 'seller') throw new HttpError(403, 'Only the store owner can read its inbox');
    assertCan(ctx.actor, 'read', 'contactMessages');
    const params = request.nextUrl.searchParams;
    const status = params.get('status');
    if (status !== null && !CONTACT_STATUSES_LIST.includes(status)) return jsonError(422, 'status must be new, read, replied or closed');
    const { page, limit } = pageOf(params);

    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    const storeId = await resolveOwnedStoreId(request, ctx, null, { capability: 'contact.read' });
    const filter: Record<string, unknown> = { scope: 'store', store: storeId };
    if (status !== null) filter.status = status;

    const [rows, totalDocs] = await Promise.all([
      ContactMessage.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      ContactMessage.countDocuments(filter),
    ]);
    const docs = (rows as unknown as Record<string, unknown>[]).map((row) => contactToWire(row));
    return NextResponse.json(listEnvelope(docs, { page, limit, totalDocs }), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
