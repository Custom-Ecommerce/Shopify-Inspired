import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as notificationsNs from '@markaz/notifications';
import { unwrapCjs } from '@/lib/cjs';
import { HttpError, handleRouteError, jsonError } from '@/lib/http';
import { SWEEP_DEFAULT_DAYS, SWEEP_MAX_DAYS, SWEEP_MIN_DAYS, sweepOrphanMedia } from '@/lib/media-sweep';
import { connectSellerDb } from '@/lib/mongo';

const notifications: typeof notificationsNs = unwrapCjs(notificationsNs);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BODY_CODE = 'MEDIA_SWEEP_BODY_INVALID';
const KEYS = ['apply', 'olderThanDays', 'after'];

/**
 * POST /api/internal/media/orphans (Sprint 7, S7-B1, CO-10). A hand-called job (SETUP.md, scheduled jobs): OUTBOX_CRON_SECRET in x-cron-secret or as
 * Authorization: Bearer <secret>, like the other internal jobs. Lists the media records that nothing uses (every feature registered with
 * lib/media-usage.ts is asked) and that are older than N days. A DRY RUN unless the body is { "apply": true }: an empty body only lists. Apply removes the
 * records and their Cloudinary files. At most 500 records are scanned per call; `more` and `nextAfter` say how to continue ({ "after": "<nextAfter>" }).
 *
 *   body (all optional): { apply?: boolean, olderThanDays?: whole number 1..365 (default 30), after?: ObjectId }
 *   200 { dryRun, olderThanDays, cutoff, scanned, orphanCount, orphans, deleted, fileFailures, keptInUse, more, nextAfter }
 *   400 MEDIA_SWEEP_BODY_INVALID { field }   401 wrong or missing secret (an unset secret closes the route)   503 the database is unavailable
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    if (!notifications.cronSecretMatches(request.headers, process.env.OUTBOX_CRON_SECRET)) return jsonError(401, 'Unauthorized');

    let apply = false;
    let olderThanDays = SWEEP_DEFAULT_DAYS;
    let after: string | null = null;
    const text = (await request.text().catch(() => '')).trim();
    if (text !== '') {
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return jsonError(400, 'Body must be JSON', BODY_CODE);
      }
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return jsonError(400, 'The body is a JSON object', BODY_CODE);
      const body = raw as Record<string, unknown>;
      const extra = Object.keys(body).find((key) => !KEYS.includes(key));
      if (extra !== undefined) return jsonError(400, 'Unknown field ' + extra, BODY_CODE, extra);
      if (body.apply !== undefined) {
        if (typeof body.apply !== 'boolean') return jsonError(400, 'apply must be true or false', BODY_CODE, 'apply');
        apply = body.apply;
      }
      if (body.olderThanDays !== undefined) {
        const days = body.olderThanDays;
        if (typeof days !== 'number' || !Number.isInteger(days) || days < SWEEP_MIN_DAYS || days > SWEEP_MAX_DAYS) {
          return jsonError(400, 'olderThanDays is a whole number of days from ' + SWEEP_MIN_DAYS + ' to ' + SWEEP_MAX_DAYS, BODY_CODE, 'olderThanDays');
        }
        olderThanDays = days;
      }
      if (body.after !== undefined) {
        if (typeof body.after !== 'string' || !/^[0-9a-fA-F]{24}$/.test(body.after)) return jsonError(400, 'after is a media id', BODY_CODE, 'after');
        after = body.after;
      }
    }

    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    const result = await sweepOrphanMedia({ apply, olderThanDays, now: new Date(), after });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
