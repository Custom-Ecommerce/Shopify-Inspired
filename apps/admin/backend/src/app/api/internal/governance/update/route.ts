
import { Types } from 'mongoose';
import { assertCan, PolicyDeniedError, Store, SyncOutbox, enqueueSyncEvent, registerSyncOutboxModel, type SyncOutboxModelPort } from '@/lib/workspace';
import { connectDb } from '@/lib/db';
import { isRecord, jsonResponse, requireInternalSignature } from '@/lib/internal-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

registerSyncOutboxModel(SyncOutbox as unknown as SyncOutboxModelPort);

const ALLOWED_STATUSES = ['active', 'suspended'];

interface GovernanceUpdate {
  storeId: string;
  status: 'active' | 'suspended';
}

function readUpdate(value: unknown): GovernanceUpdate | null {
  if (!isRecord(value)) return null;
  const { storeId, status } = value;
  if (typeof storeId !== 'string' || !Types.ObjectId.isValid(storeId)) return null;
  if (typeof status !== 'string' || !ALLOWED_STATUSES.includes(status)) return null;
  return { storeId, status: status as GovernanceUpdate['status'] };
}

/**
 * Governance update placeholder: sets a store's status and queues the sync event for the seller.
 * Runs as the system actor, so the policy matrix decides whether the write is allowed.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireInternalSignature(request);
  if (!auth.ok) return auth.response;

  let parsed: unknown;
  try {
    parsed = JSON.parse(auth.rawBody);
  } catch {
    return jsonResponse({ error: 'invalid JSON' }, 400);
  }
  const update = readUpdate(parsed);
  if (!update) return jsonResponse({ error: 'invalid body' }, 422);

  try {
    assertCan('system', 'update', 'stores', ['status']);
    assertCan('system', 'create', 'sync-outbox');
  } catch (err) {
    if (err instanceof PolicyDeniedError) return jsonResponse({ error: err.message }, 403);
    throw err;
  }

  await connectDb();
  const result = await Store.updateOne({ _id: update.storeId }, { $set: { status: update.status }, $inc: { govRevision: 1 } });
  if (result.matchedCount === 0) return jsonResponse({ error: 'store not found' }, 404);

  const queued = await enqueueSyncEvent({
    target: 'seller',
    entity: 'store',
    entityId: update.storeId,
    group: 'governance',
    payload: { status: update.status },
  });
  return jsonResponse({ queued }, 200);
}
