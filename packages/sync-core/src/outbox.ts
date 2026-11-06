
import { randomBytes } from 'node:crypto';

export const MAX_REVISION_ATTEMPTS = 5;

const DUPLICATE_KEY_CODE = 11000;
const SYNC_TARGETS = ['admin', 'seller'] as const;

export type SyncOutboxTarget = (typeof SYNC_TARGETS)[number];

export interface SyncOutboxModelPort {
  create(doc: Record<string, unknown>): Promise<unknown>;
  find(filter: Record<string, unknown>): any;
  findOne(filter: Record<string, unknown>): any;
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<unknown>;
  updateMany(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<unknown>;
}

let registeredOutboxModel: SyncOutboxModelPort | null = null;

/** Each backend registers its outbox model once at boot. */
export function registerSyncOutboxModel(model: SyncOutboxModelPort): void {
  registeredOutboxModel = model;
}

export function getSyncOutboxModel(): SyncOutboxModelPort {
  if (registeredOutboxModel === null) {
    throw new Error('SyncOutbox model is not registered with @markaz/sync-core');
  }
  return registeredOutboxModel;
}

export interface EnqueueSyncEventInput {
  target: SyncOutboxTarget;
  entity: string;
  entityId: string;
  group: string;
  payload: Record<string, unknown>;
}

export interface EnqueueSyncEventResult {
  id: string | null;
  eventId: string;
  entity: string;
  entityId: string;
  group: string;
  revision: number;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A ULID, the form the envelope schema requires: 48 bits of time, 80 bits of randomness. */
function newEventId(now: number = Date.now()): string {
  let time = '';
  let remaining = now;
  for (let i = 0; i < 10; i += 1) {
    time = CROCKFORD[remaining % 32] + time;
    remaining = Math.floor(remaining / 32);
  }
  const bytes = randomBytes(16);
  let random = '';
  for (let i = 0; i < 16; i += 1) {
    random += CROCKFORD[bytes[i] % 32];
  }
  return time + random;
}

function assertNonEmpty(field: string, value: unknown): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('enqueueSyncEvent: ' + field + ' is required');
  }
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === DUPLICATE_KEY_CODE;
}

function extractId(doc: unknown): string | null {
  if (typeof doc !== 'object' || doc === null) return null;
  const record = doc as { _id?: unknown };
  return record._id === undefined ? null : String(record._id);
}

/**
 * Writes one pending row the dispatcher can send. The revision orders rows for one
 * (entity, entityId, group). The dispatcher reads the source of record when it sends, so the
 * stored revision is an ordering aid, not the authority. A duplicate key re-reads the head and
 * retries, up to MAX_REVISION_ATTEMPTS times.
 */
export async function enqueueSyncEvent(input: EnqueueSyncEventInput): Promise<EnqueueSyncEventResult> {
  if (!SYNC_TARGETS.includes(input.target)) {
    throw new Error('enqueueSyncEvent: unsupported target');
  }
  assertNonEmpty('entity', input.entity);
  assertNonEmpty('entityId', input.entityId);
  assertNonEmpty('group', input.group);
  if (typeof input.payload !== 'object' || input.payload === null) {
    throw new Error('enqueueSyncEvent: payload must be an object');
  }

  const model = getSyncOutboxModel();
  const key = { entity: input.entity, entityId: input.entityId, group: input.group };

  for (let attempt = 1; attempt <= MAX_REVISION_ATTEMPTS; attempt += 1) {
    const head = (await model.findOne(key).sort({ revision: -1 }).lean().exec()) as
      | { revision?: unknown }
      | null;
    const headRevision = head !== null && typeof head.revision === 'number' ? head.revision : 0;
    const revision = headRevision + 1;
    const eventId = newEventId();
    try {
      const doc = await model.create({
        eventId,
        target: input.target,
        entity: input.entity,
        entityId: input.entityId,
        group: input.group,
        revision,
        payload: input.payload,
        status: 'pending',
        attempts: 0,
        nextAttemptAt: new Date(),
      });
      return {
        id: extractId(doc),
        eventId,
        entity: input.entity,
        entityId: input.entityId,
        group: input.group,
        revision,
      };
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
    }
  }

  throw new Error(
    'enqueueSyncEvent: could not allocate a revision for ' + input.entity + '/' + input.entityId + '/' +
      input.group + ' after ' + MAX_REVISION_ATTEMPTS + ' attempts',
  );
}
