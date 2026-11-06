import { Store, SyncOutbox } from '@markaz/db-schemas';
import { SYNC_GROUP_ALLOWLISTS, filterToAllowlist, isAllowlistedPath } from '@markaz/platform-kit';
import type { OutboxRecord, SyncEnvelope, SyncPersistence } from './index';

/**
* Mongoose implementation of SyncPersistence.
*
* Applied revisions live on the store document: governance in govRevision,
* operations in opsRevision. Writes are conditional on the stored revision
* being lower, so two racing deliveries of the same or older revision cannot
* both win. Other entity/group pairs have no model yet and fail loudly.
* entityId is the store _id (24-hex ObjectId string).
*/

export class UnsupportedSyncGroupError extends Error {
constructor(entity: string, group: string) {
super('No persistence mapping for sync group ' + entity + '.' + group);
this.name = 'UnsupportedSyncGroupError';
}
}

export class SyncEntityNotFoundError extends Error {
constructor(entity: string, entityId: string) {
super('Sync target ' + entity + ' ' + entityId + ' does not exist');
this.name = 'SyncEntityNotFoundError';
}
}

/** The stored revision is already at or above the incoming one. */
export class StaleRevisionError extends Error {
constructor(entity: string, entityId: string, group: string, revision: number) {
super('Stale revision ' + revision + ' for ' + entity + '.' + group + ' ' + entityId);
this.name = 'StaleRevisionError';
}
}

export class UnsafeSyncPayloadError extends Error {
constructor() {
super('Sync payload contains a key that is not safe to write (leading $, dot, or __proto__)');
this.name = 'UnsafeSyncPayloadError';
}
}

const STORE_REVISION_FIELDS: Readonly<Record<string, string>> = {
governance: 'govRevision',
operations: 'opsRevision',
};

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const MAX_PAYLOAD_DEPTH = 32;

function hasOwn(obj: object, key: string): boolean {
return Object.prototype.hasOwnProperty.call(obj, key);
}

function revisionFieldFor(entity: string, group: string): string {
if (entity === 'store' && hasOwn(STORE_REVISION_FIELDS, group)) {
return STORE_REVISION_FIELDS[group];
}
throw new UnsupportedSyncGroupError(entity, group);
}

function allowlistFor(group: string): readonly string[] {
if (!hasOwn(SYNC_GROUP_ALLOWLISTS, group)) {
throw new UnsupportedSyncGroupError('?', group);
}
return (SYNC_GROUP_ALLOWLISTS as Record<string, readonly string[]>)[group];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
const proto: unknown = Object.getPrototypeOf(value);
return proto === Object.prototype || proto === null;
}

function hasUnsafeKey(value: unknown, depth: number = 0): boolean {
if (depth > MAX_PAYLOAD_DEPTH) return true;
if (Array.isArray(value)) return value.some((item) => hasUnsafeKey(item, depth + 1));
if (typeof value !== 'object' || value === null) return false;
return Object.keys(value).some(
(key) =>
key.charAt(0) === '$' ||
key.indexOf('.') !== -1 ||
key === '__proto__' ||
hasUnsafeKey((value as Record<string, unknown>)[key], depth + 1),
);
}

/**
* Turn a filtered snapshot into $set paths. A path the allowlist covers whole
* (exact or by wildcard) is replaced as a unit; anything else is flattened to
* dotted paths so sibling fields the sender does not own (for example
* billing.stripeConnectedAccountId) are never overwritten.
*/
function toSetPaths(
allowlist: readonly string[],
data: Record<string, unknown>,
prefix: string = '',
out: Record<string, unknown> = {},
): Record<string, unknown> {
for (const key of Object.keys(data)) {
const fullPath = prefix === '' ? key : prefix + '.' + key;
const value = data[key];
if (isAllowlistedPath(allowlist, fullPath) || !isPlainObject(value)) {
out[fullPath] = value;
} else {
toSetPaths(allowlist, value, fullPath, out);
}
}
return out;
}

export function createMongooseSyncPersistence(): SyncPersistence {
return {
async load(entity: string, entityId: string, group: string): Promise<number | null> {
const field = revisionFieldFor(entity, group);
if (!OBJECT_ID.test(entityId)) return null;

const doc = await Store.findById(entityId)
.select({ [field]: 1 })
.lean<Record<string, unknown> | null>();
if (!doc) return null;

const value = doc[field];
return typeof value === 'number' ? value : 0;
},

async save(envelope: SyncEnvelope): Promise<void> {
const { entity, entityId, group, revision } = envelope;
const field = revisionFieldFor(entity, group);
if (!OBJECT_ID.test(entityId)) throw new SyncEntityNotFoundError(entity, entityId);

// Defence in depth: the caller filters too, but save never writes outside the allowlist.
const allowlist = allowlistFor(group);
const { data } = filterToAllowlist(envelope.data, allowlist);
if (hasUnsafeKey(data)) throw new UnsafeSyncPayloadError();

const set = toSetPaths(allowlist, data);
set[field] = revision;

const filter: Record<string, unknown> = { _id: entityId };
filter[field] = { $lt: revision };

const result = await Store.updateOne(filter, { $set: set }, { runValidators: true });
if (result.matchedCount === 1) return;

const exists = await Store.exists({ _id: entityId });
if (!exists) throw new SyncEntityNotFoundError(entity, entityId);
throw new StaleRevisionError(entity, entityId, group, revision);
},

async outboxWrite(record: Omit<OutboxRecord, 'status' | 'attempts'>): Promise<void> {
await SyncOutbox.create({
...record,
status: 'pending',
attempts: 0,
nextAttemptAt: record.nextAttemptAt ?? new Date(),
});
},
};
}
