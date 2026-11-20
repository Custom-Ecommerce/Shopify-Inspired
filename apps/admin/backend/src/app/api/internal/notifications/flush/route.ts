import * as notificationsNs from '@markaz/notifications';
import { errorResponse, requireDatabase } from '@/lib/admin-auth';
import { outboxModel } from '@/lib/admin-account';
import { unwrapCjs } from '@/lib/cjs';

const notifications: typeof notificationsNs = unwrapCjs(notificationsNs);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET or POST /api/internal/notifications/flush on the admin backend: the same retry as the seller backend's, for the
 * emails the admin backend queues (operator password reset; payouts later). OUTBOX_CRON_SECRET in x-cron-secret or as
 * a bearer token; 401 when it is unset, short or wrong.
 */
async function flush(request: Request): Promise<Response> {
  try {
    if (!notifications.cronSecretMatches(request.headers, process.env.OUTBOX_CRON_SECRET)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }
    await requireDatabase();
    const summary = await notifications.flushOutbox(outboxModel(), { provider: notifications.providerFromEnv() });
    return Response.json(summary, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(request: Request): Promise<Response> {
  return flush(request);
}

export async function POST(request: Request): Promise<Response> {
  return flush(request);
}
