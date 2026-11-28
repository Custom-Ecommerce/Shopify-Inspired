
import { timingSafeEqual } from 'node:crypto';
import { drainSyncOutbox } from '@markaz/sync-core';
import { runAfterResponse } from '@/lib/admin-account';
import { connectDb } from '@/lib/db';
import { pushSyncFailure } from '@/lib/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function bearerMatches(header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const expected = Buffer.from('Bearer ' + secret);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function handle(request: Request): Promise<Response> {
  if (!bearerMatches(request.headers.get('authorization'), process.env.CRON_SECRET ?? '')) {
    return Response.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  await connectDb();
  const summary = await drainSyncOutbox();
  // Sprint 9 (EP-31.US02): owners and operations are told on their phones when events were given up on.
  if (summary.dead > 0) runAfterResponse('push_sync_failure', () => pushSyncFailure(summary.dead));
  return Response.json(summary, { status: 200 });
}

/** Vercel Cron sends GET with the Authorization header. */
export async function GET(request: Request): Promise<Response> {
  return handle(request);
}

/** Manual trigger with the same bearer secret. */
export async function POST(request: Request): Promise<Response> {
  return handle(request);
}
