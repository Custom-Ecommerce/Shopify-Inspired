import { isRecord, jsonResponse, requireSyncSignature } from '../_guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/internal/sync/repair. Asks for a replay of a range of revisions to a seller. The request is checked and
 * signed like every sync call, but no replay is built yet, so nothing is queued. The answer says so (501) rather
 * than acknowledging a repair that will never run. Build the replay before answering 202 here.
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

  if (
    !isRecord(payload) ||
    typeof payload.store !== 'string' ||
    typeof payload.fromRevision !== 'number' ||
    typeof payload.toRevision !== 'number' ||
    payload.fromRevision > payload.toRevision
  ) {
    return jsonResponse({ error: 'invalid repair request' }, 422);
  }

  return jsonResponse({ error: 'revision repair is not implemented; nothing was queued' }, 501);
}
