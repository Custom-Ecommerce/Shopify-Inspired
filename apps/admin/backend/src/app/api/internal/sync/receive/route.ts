import { connectDb } from '@/lib/db';
import { receiveBatch } from '@/lib/sync-receiver';
import { jsonResponse, requireSyncSignature } from '../_guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/internal/sync/receive (Sprint 6 EP-16, D-106). Signed (HMAC, unchanged). One shared database: NO data is applied here; the acknowledged
 * revision per (store, group) is recorded, idempotently, and a stale revision is reported and ignored. Always 202 for a valid batch, 422 for a bad shape.
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
  const summary = await receiveBatch(payload);
  if (summary === null) return jsonResponse({ error: 'invalid sync batch' }, 422);
  return jsonResponse(summary, 202);
}
