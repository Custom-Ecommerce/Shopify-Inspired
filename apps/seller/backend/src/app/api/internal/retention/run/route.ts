import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { HttpError, handleRouteError, jsonError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { runRetention } from '@/lib/retention-purge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

/**
 * POST /api/internal/retention/run (Sprint 6 S6-B7). The scheduler's purge of every retention target (see lib/retention-policy.ts), with
 * RETENTION_CRON_SECRET in x-retention-secret. A DRY RUN unless the body is { "apply": true }: an empty body, {} or { "apply": false } only counts. Capped
 * per target per run; one audit line per run. Unset secret: 503; wrong secret: 401. The clock is the server's. The ledger, the audit log and subscription
 * payments are never in it.
 *   200 { dryRun, targets: [{ key, days, eligible, purged, more }], at }   400 bad body
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const secret = process.env.RETENTION_CRON_SECRET ?? '';
    if (secret === '') return jsonError(503, 'Retention is not configured');
    if (!timingSafeEqual(digest(request.headers.get('x-retention-secret') ?? ''), digest(secret))) return jsonError(401, 'Unauthorized');
    let apply = false;
    const text = (await request.text().catch(() => '')).trim();
    if (text !== '') {
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return jsonError(400, 'Body must be JSON');
      }
      const keys = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? Object.keys(raw) : ['?'];
      const value = (raw as { apply?: unknown } | null)?.apply;
      if (keys.some((k) => k !== 'apply') || (value !== undefined && typeof value !== 'boolean')) return jsonError(400, 'The body is { "apply": true } to apply, or empty for a dry run', 'RETENTION_BODY_INVALID', 'apply');
      apply = value === true;
    }
    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    return NextResponse.json(await runRetention({ apply, now: new Date(), actorId: 'system:retention' }), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
