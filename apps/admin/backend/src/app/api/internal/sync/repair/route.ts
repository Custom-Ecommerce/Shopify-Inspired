import { connectDb } from '@/lib/db';
import { repair } from '@/lib/sync-receiver';
import { jsonResponse, requireSyncSignature } from '../_guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/internal/sync/repair { store, group?, fromRevision, toRevision }. Signed. Requeues the missing range in the sender outbox (sent or dead rows
 * back to pending); never replays what is already acknowledged; idempotent. 202 with the counts, 422 for a bad or too long range.
 */
export async function POST(request: Request): Promise<Response> {
  const guard = await requireSyncSignature(request);
  if (!guard.ok) return guard.response;

  let payload: unknown;
  try {
    payload = JSON.parse(guard.rawBody);
  } catch {
    return jsonResponse({ error: 'invalid JSON' }, 400);
  }
  await connectDb();
  const result = await repair(payload);
  if (!result.ok) return jsonResponse({ error: result.error }, 422);
  return jsonResponse(result.body, 202);
}
