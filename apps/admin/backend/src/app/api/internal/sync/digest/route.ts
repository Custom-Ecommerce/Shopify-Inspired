import { isRecord, jsonResponse, requireSyncSignature } from '../_guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const guard = await requireSyncSignature(request);
  if (!guard.ok) return guard.response;

  let payload: unknown;
  try {
    payload = JSON.parse(guard.rawBody);
  } catch {
    return jsonResponse({ error: 'invalid JSON' }, 400);
  }

  if (!isRecord(payload) || typeof payload.store !== 'string' || typeof payload.headRevision !== 'number') {
    return jsonResponse({ error: 'invalid digest' }, 422);
  }

  // TODO: compare headRevision with the admin receiver's acknowledged revision for this store
  // and return the revision range the seller must replay.
  return jsonResponse(
    {
      store: payload.store,
      headRevision: payload.headRevision,
      status: 'digest-recorded',
      checkedAt: new Date().toISOString(),
    },
    200
  );
}
