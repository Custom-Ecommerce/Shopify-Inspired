import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as notificationsNs from '@markaz/notifications';
import { unwrapCjs } from '@/lib/cjs';
import { expiryJobRequestSchema } from '@/lib/contracts';
import { HttpError, handleRouteError, jsonError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { runSubscriptionExpiry } from '@/lib/subscription-expiry';

const notifications: typeof notificationsNs = unwrapCjs(notificationsNs);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/internal/subscriptions/expire (Sprint 6 EP-14.US02, D-118): the expiry job. Called by a scheduler with OUTBOX_CRON_SECRET
 * (x-cron-secret or Authorization: Bearer), exactly like /api/internal/commission/backfill. It moves trial, active, grace and cancelled
 * subscriptions along the calendar (lib/subscription-expiry.ts).
 *
 * It is a DRY RUN unless the body says { "apply": true }: an empty body, {} or { "apply": false } only counts. GET is always a dry run.
 *
 *   200 { dryRun, scanned, trialToExpired, activeToGrace, graceToExpired, cancelledToExpired, skipped, failed }
 *   400 the body is not { apply?: boolean }   401 the secret is missing on the server, too short, or not the one sent   503 no database
 */
async function run(request: NextRequest, applyAllowed: boolean): Promise<Response> {
  try {
    if (!notifications.cronSecretMatches(request.headers, process.env.OUTBOX_CRON_SECRET)) return jsonError(401, 'Unauthorized');

    let apply = false;
    if (applyAllowed) {
      const text = await request.text().catch(() => '');
      if (text.trim() !== '') {
        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch {
          return jsonError(400, 'Body must be JSON');
        }
        const parsed = expiryJobRequestSchema.safeParse(raw);
        if (!parsed.success) return jsonError(400, 'The body is { "apply": true } to apply, or empty for a dry run', 'EXPIRY_BODY_INVALID', 'apply');
        apply = parsed.data.apply === true;
      }
    }

    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    return NextResponse.json(await runSubscriptionExpiry({ apply }), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  return run(request, true);
}

/** A GET never applies: a scheduler or a browser can look, only a deliberate POST with apply can change. */
export async function GET(request: NextRequest): Promise<Response> {
  return run(request, false);
}
