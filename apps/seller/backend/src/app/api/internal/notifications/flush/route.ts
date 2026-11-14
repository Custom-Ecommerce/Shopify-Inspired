import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as notificationsNs from '@markaz/notifications';
import { unwrapCjs } from '@/lib/cjs';
import { HttpError, handleRouteError, jsonError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { outboxModel } from '@/lib/notifications';

const notifications: typeof notificationsNs = unwrapCjs(notificationsNs);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET or POST /api/internal/notifications/flush (EP-07.US01.T02). Called by a scheduler (every few minutes) with
 * OUTBOX_CRON_SECRET in the x-cron-secret header or as Authorization: Bearer <secret>. Sends the queued and failed messages
 * that are due, at most 50 per call, each claimed by a compare-and-set so two calls never send the same row twice; a
 * failure waits 2, 4, 8, then 16 minutes, and a row stops after 5 tries.
 *
 *   200 { picked, sent, skipped, retry, failed, notClaimed, errors }
 *   401 the secret is missing on the server, too short, or not the one sent (a missing setting closes the route)
 *   503 the database is unavailable
 */
async function flush(request: NextRequest): Promise<Response> {
  try {
    if (!notifications.cronSecretMatches(request.headers, process.env.OUTBOX_CRON_SECRET)) return jsonError(401, 'Unauthorized');
    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    const summary = await notifications.flushOutbox(outboxModel(), { provider: notifications.providerFromEnv() });
    return NextResponse.json(summary, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  return flush(request);
}

export async function POST(request: NextRequest): Promise<Response> {
  return flush(request);
}
