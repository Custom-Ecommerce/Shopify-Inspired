import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { recordUnsubscribe, unsubscribeSecret, verifyUnsubscribe } from '@/lib/broadcast';
import { unsubscribeRequestSchema } from '@/lib/contracts';
import { HttpError, handleRouteError, jsonError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/unsubscribe { store, email, sig } (Sprint 4 EP-07.US04, D-092). PUBLIC: the customer has no session, the signature
 * in the link is the proof (HMAC-SHA256 over the store id and the email, UNSUBSCRIBE_SIGNING_SECRET).
 *
 *   200 { ok: true }  the customer will get no more broadcasts of that store; the same answer the second time (idempotent)
 *   404 the link is not valid, for ANY reason (bad signature, malformed link, the secret is not set): the answer never says why
 *
 * Order and status emails are not affected by an unsubscribe.
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const secret = unsubscribeSecret();
    if (secret === null) return jsonError(404, 'This link is not valid.');
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonError(404, 'This link is not valid.');
    }
    const parsed = unsubscribeRequestSchema.safeParse(raw);
    if (!parsed.success || !verifyUnsubscribe(parsed.data.store, parsed.data.email, parsed.data.sig, secret)) {
      return jsonError(404, 'This link is not valid.');
    }
    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Please try again in a moment.');
    });
    await recordUnsubscribe(parsed.data.store, parsed.data.email);
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
