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

  if (
    !isRecord(payload) ||
    typeof payload.store !== 'string' ||
    typeof payload.toRevision !== 'number' ||
    !Array.isArray(payload.events)
  ) {
    return jsonResponse({ error: 'invalid sync batch' }, 422);
  }

  // TODO: persist idempotently keyed by (store, revision) in the admin receiver store.
  return jsonResponse(
    {
      accepted: payload.events.length,
      store: payload.store,
      acknowledgedRevision: payload.toRevision,
      receivedAt: new Date().toISOString(),
    },
    202
  );
}
