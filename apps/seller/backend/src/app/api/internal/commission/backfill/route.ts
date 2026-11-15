import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as notificationsNs from '@markaz/notifications';
import { unwrapCjs } from '@/lib/cjs';
import { backfillCommission } from '@/lib/commission-backfill';
import { HttpError, handleRouteError, jsonError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';

const notifications: typeof notificationsNs = unwrapCjs(notificationsNs);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET or POST /api/internal/commission/backfill (Sprint 4 EP-05.US01, D-088). The retry for ledger writes that failed or
 * were missed: called by a scheduler with OUTBOX_CRON_SECRET (x-cron-secret or Authorization: Bearer), exactly like
 * /api/internal/notifications/flush. Finds delivered-and-collected COD orders and paid card orders that lack their entries
 * (oldest first, at most 100 per call) and writes the missing ones. NOTE: a backfilled entry uses the commission rate that
 * applies NOW, not the one in force when the order was delivered or paid.
 *
 *   200 { scanned, written, failed }   401 the secret is missing on the server, too short, or not the one sent   503 no database
 */
async function run(request: NextRequest): Promise<Response> {
  try {
    if (!notifications.cronSecretMatches(request.headers, process.env.OUTBOX_CRON_SECRET)) return jsonError(401, 'Unauthorized');
    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    return NextResponse.json(await backfillCommission(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  return run(request);
}

export async function POST(request: NextRequest): Promise<Response> {
  return run(request);
}
