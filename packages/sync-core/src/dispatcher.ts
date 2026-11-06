
/**
 * Sync v2 outbox dispatcher. Mongoose port of the legacy Payload dispatcher
 * (apps/admin/src/lib/sync/dispatcher.ts): per-row claim with a lease, source-of-record
 * snapshots at send time, bootstrap revisions, backoff, dead-letter, governance first.
 *
 * Statuses are the Payload set only: pending, sent, dead (E3).
 * H-R guard: a revision below the seller's acknowledged revision is dead-lettered, never published.
 */
import mongoose from 'mongoose';
import { PLATFORM_SETTINGS_GLOBAL_TYPE, SyncOutbox, type ISyncOutbox } from '@markaz/db-schemas';
import {
  SYNC_SCHEMA_VERSION,
  buildSyncHeaders,
  computeDataHash,
  filterToGroupAllowlist,
  syncEnvelopeSchema,
} from '@markaz/platform-kit';

const SELF_SOURCE = 'admin';
const BACKOFF_MS: readonly number[] = [5000, 30000, 120000, 600000, 3600000, 21600000];
export const DRAIN_MAX_ATTEMPTS = 24;
const PERMANENT_STATUSES: ReadonlySet<number> = new Set<number>([400, 401, 403, 413, 422]);
const DELIVERY_TIMEOUT_MS = 10000;
const DIGEST_TIMEOUT_MS = 10000;
const LEASE_MS = 60000;
const DEFAULT_LIMIT = 50;
const DEFAULT_BUDGET_MS = 40000;
const CAS_RETRIES = 5;
const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;

type Group = 'governance' | 'controls' | 'settings';
type Entity = 'store' | 'seller' | 'platform';

export interface DrainOptions {
  limit?: number;
  budgetMs?: number;
}

export interface DrainSummary {
  configured: boolean;
  examined: number;
  sent: number;
  retry: number;
  dead: number;
  skipped: number;
}

interface OutboxRow {
  _id: mongoose.Types.ObjectId;
  eventId: string;
  entity: Entity;
  entityId: string;
  group: Group;
  revision: number;
  attempts?: number;
}

interface Binding {
  entity: Entity;
  group: Group;
  collection: string;
  revisionField: string;
  filterFor: (entityId: string) => Record<string, unknown> | null;
  prepare: (raw: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

interface LoadedSource {
  bumpFilter: Record<string, unknown>;
  raw: Record<string, unknown>;
  prepared: Record<string, unknown>;
}

interface Transport {
  baseUrl: string;
  keyId: string;
  secret: string;
}

type Delivery = { kind: 'sent' } | { kind: 'dead'; error: string } | { kind: 'retry'; error: string };
type RowResult = 'sent' | 'retry' | 'dead' | 'skipped';

interface DigestKey {
  entity: string;
  entityId: string;
  group: string;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function keyOf(entity: string, entityId: string, group: string): string {
  return entity + '|' + entityId + '|' + group;
}

function groupRank(group: string): number {
  return group === 'governance' ? 0 : 1; // governance before the groups that depend on it (7.2.5)
}

export function drainBackoffMs(attempts: number): number {
  const index = Math.min(Math.max(attempts - 1, 0), BACKOFF_MS.length - 1);
  return BACKOFF_MS[index];
}

function pruneNulls(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(value)) {
    if (member === null || member === undefined) continue;
    if (typeof member === 'object' && !Array.isArray(member)) {
      out[key] = pruneNulls(member as Record<string, unknown>);
    } else {
      out[key] = member;
    }
  }
  return out;
}

function hashSnapshot(data: Record<string, unknown>): string {
  return computeDataHash(pruneNulls(data));
}

/** JSON round trip turns ObjectIds into hex strings and Dates into ISO strings, as the envelope needs. */
function allowlistSnapshot(group: Group, doc: Record<string, unknown>): Record<string, unknown> {
  const normalized = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
  return filterToGroupAllowlist(group, normalized).data;
}

async function rawFindOne(
  collection: string,
  filter: Record<string, unknown>,
  projection?: Record<string, number>,
): Promise<Record<string, unknown> | null> {
  const doc = await mongoose.connection
    .collection(collection)
    .findOne(filter as never, projection ? { projection } : {});
  return (doc as Record<string, unknown> | null) ?? null;
}

const BINDINGS: readonly Binding[] = [
  {
    entity: 'store',
    group: 'governance',
    collection: 'stores',
    revisionField: 'govRevision',
    filterFor: (entityId) => (OBJECT_ID_PATTERN.test(entityId) ? { _id: new mongoose.Types.ObjectId(entityId) } : null),
    prepare: async (raw) => {
      if (raw.owner === null || raw.owner === undefined) return raw;
      const seller = await rawFindOne('sellers', { _id: raw.owner }, { sellerId: 1 });
      const sellerId = seller && typeof seller.sellerId === 'string' && seller.sellerId ? seller.sellerId : null;
      if (!sellerId) {
        throw new Error('OWNER_TRANSLATION_PENDING: no sellers mirror with a sellerId for owner ' + String(raw.owner));
      }
      return { ...raw, owner: sellerId };
    },
  },
  {
    entity: 'seller',
    group: 'controls',
    collection: 'sellers',
    revisionField: 'controlsRevision',
    filterFor: (entityId) => (entityId ? { sellerId: entityId } : null),
    prepare: async (raw) => raw,
  },
  {
    entity: 'platform',
    group: 'settings',
    collection: 'globals',
    revisionField: 'settingsRevision',
    filterFor: (entityId) => (entityId === 'platform' ? { globalType: PLATFORM_SETTINGS_GLOBAL_TYPE } : null),
    prepare: async (raw) => raw,
  },
];

async function loadSource(binding: Binding, entityId: string): Promise<LoadedSource | null> {
  const filter = binding.filterFor(entityId);
  if (!filter) return null;
  const raw = await rawFindOne(binding.collection, filter);
  if (!raw) return null;
  const prepared = await binding.prepare(raw);
  return { bumpFilter: { _id: raw._id }, raw, prepared };
}

/** Bootstrap: a never-bumped entity gets revision 1. Compare-and-set, as the legacy bumpRevision. */
async function bumpBootstrapRevision(binding: Binding, bumpFilter: Record<string, unknown>): Promise<number> {
  const collection = mongoose.connection.collection(binding.collection);
  const field = binding.revisionField;
  for (let attempt = 0; attempt < CAS_RETRIES; attempt += 1) {
    const row = await collection.findOne(bumpFilter as never, { projection: { [field]: 1 } });
    if (!row) throw new Error('source document not found for ' + binding.entity + '.' + binding.group);
    const current = typeof row[field] === 'number' ? (row[field] as number) : 0;
    const target = Math.max(current, 1);
    if (target === current) return current;
    const match = current === 0 ? { $in: [0, null] } : current;
    const result = await collection.updateOne(
      { ...bumpFilter, [field]: match } as never,
      { $set: { [field]: target } } as never,
    );
    if (result.modifiedCount === 1) return target;
  }
  throw new Error('Could not advance ' + binding.entity + '.' + binding.group + ' revision (concurrent updates); retry.');
}

function resolveTransport(): Transport | null {
  let baseUrl = process.env.SELLER_BACKEND_API_URL ?? '';
  while (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
  const keyId = process.env.SYNC_KEY_ID_CURRENT ?? '';
  const secret = process.env.SYNC_SECRET_CURRENT ?? '';
  if (!baseUrl || !keyId || !secret) return null;
  return { baseUrl, keyId, secret };
}

/** H-R input: the seller's acknowledged revision for each key, from its signed digest endpoint. */
async function fetchAcknowledged(transport: Transport, keys: readonly DigestKey[]): Promise<Map<string, number | null>> {
  const body = JSON.stringify({ items: keys });
  const headers = buildSyncHeaders({ keyId: transport.keyId, secret: transport.secret, rawBody: body });
  const response = await fetch(transport.baseUrl + '/api/internal/sync/digest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
    signal: AbortSignal.timeout(DIGEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error('digest responded ' + response.status);
  const json = (await response.json().catch(() => null)) as { revisions?: Record<string, number | null> } | null;
  const map = new Map<string, number | null>();
  for (const key of keys) {
    const id = keyOf(key.entity, key.entityId, key.group);
    const value = json?.revisions?.[id];
    map.set(id, typeof value === 'number' ? value : null);
  }
  return map;
}

async function claimRow(row: OutboxRow): Promise<Date | null> {
  const now = Date.now();
  const lease = new Date(now + LEASE_MS);
  const result = await SyncOutbox.updateOne(
    { _id: row._id, status: 'pending', nextAttemptAt: { $lte: new Date(now) } },
    { $set: { nextAttemptAt: lease }, $inc: { attempts: 1 } },
  );
  return result.modifiedCount === 1 ? lease : null;
}

async function settleRow(
  row: OutboxRow,
  lease: Date,
  set: Partial<Pick<ISyncOutbox, 'status' | 'sentAt' | 'lastError' | 'nextAttemptAt'>>,
): Promise<boolean> {
  const result = await SyncOutbox.updateOne({ _id: row._id, status: 'pending', nextAttemptAt: lease }, { $set: set });
  return result.modifiedCount === 1;
}

async function loadDueRows(limit: number): Promise<OutboxRow[]> {
  const docs = await SyncOutbox.find({ target: 'seller', status: 'pending', nextAttemptAt: { $lte: new Date() } })
    .sort({ nextAttemptAt: 1, revision: 1 })
    .limit(limit)
    .lean()
    .exec();
  return docs as unknown as OutboxRow[];
}

async function deliver(row: OutboxRow, transport: Transport, acknowledged: Map<string, number | null>): Promise<Delivery> {
  const binding = BINDINGS.find((b) => b.entity === row.entity && b.group === row.group);
  if (!binding) return { kind: 'dead', error: 'UNSUPPORTED_GROUP ' + row.entity + '/' + row.group };

  let source: LoadedSource | null;
  try {
    source = await loadSource(binding, row.entityId);
  } catch (error) {
    return { kind: 'retry', error: message(error) };
  }
  if (!source) return { kind: 'dead', error: 'ENTITY_MISSING at source' };

  let revision = typeof source.raw[binding.revisionField] === 'number' ? (source.raw[binding.revisionField] as number) : 0;
  if (revision < 1) {
    try {
      revision = await bumpBootstrapRevision(binding, source.bumpFilter);
      source = await loadSource(binding, row.entityId);
    } catch (error) {
      return { kind: 'retry', error: message(error) };
    }
    if (!source) return { kind: 'dead', error: 'ENTITY_MISSING at source' };
  }

  // H-R guard: never publish a revision below the seller's acknowledged one.
  const ackRevision = acknowledged.get(keyOf(row.entity, row.entityId, row.group));
  if (typeof ackRevision === 'number' && revision < ackRevision) {
    return { kind: 'dead', error: 'STALE_REVISION ' + revision + ' is below seller acknowledged ' + ackRevision };
  }

  const data = allowlistSnapshot(binding.group, source.prepared);
  const candidate = {
    schemaVersion: SYNC_SCHEMA_VERSION,
    eventId: row.eventId,
    source: SELF_SOURCE,
    entity: row.entity,
    entityId: row.entityId,
    group: row.group,
    revision,
    occurredAt: new Date().toISOString(),
    op: 'upsert',
    data,
    dataHash: hashSnapshot(data),
  };
  const parsed = syncEnvelopeSchema.safeParse(candidate);
  if (!parsed.success) {
    return { kind: 'dead', error: 'Envelope failed local validation: ' + parsed.error.message };
  }

  const body = JSON.stringify({ envelopes: [parsed.data] });
  const headers = buildSyncHeaders({ keyId: transport.keyId, secret: transport.secret, rawBody: body });
  try {
    const response = await fetch(transport.baseUrl + '/api/internal/sync/receive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = 'HTTP ' + response.status;
      return PERMANENT_STATUSES.has(response.status) ? { kind: 'dead', error: detail } : { kind: 'retry', error: detail };
    }
    const json = (await response.json().catch(() => null)) as
      | { results?: Array<{ outcome?: string; reason?: string }> }
      | null;
    const item = json?.results?.[0];
    if (item?.outcome === 'rejected') return { kind: 'dead', error: 'REJECTED ' + (item.reason ?? '') };
    if (item?.outcome === 'failed') return { kind: 'retry', error: 'FAILED ' + (item.reason ?? '') };
    return { kind: 'sent' };
  } catch (error) {
    return { kind: 'retry', error: message(error) };
  }
}

async function processRow(row: OutboxRow, transport: Transport, acknowledged: Map<string, number | null>): Promise<RowResult> {
  const lease = await claimRow(row);
  if (!lease) return 'skipped';

  const attempts = (row.attempts ?? 0) + 1;
  const started = Date.now();
  const outcome = await deliver(row, transport, acknowledged);

  let result: RowResult;
  let settled: boolean;
  if (outcome.kind === 'sent') {
    result = 'sent';
    settled = await settleRow(row, lease, { status: 'sent', sentAt: new Date(), lastError: null });
  } else if (outcome.kind === 'dead' || attempts >= DRAIN_MAX_ATTEMPTS) {
    result = 'dead';
    settled = await settleRow(row, lease, { status: 'dead', lastError: outcome.error });
  } else {
    result = 'retry';
    settled = await settleRow(row, lease, {
      lastError: outcome.error,
      nextAttemptAt: new Date(Date.now() + drainBackoffMs(attempts)),
    });
  }

  console.info(
    '[sync:drain] ' + row.eventId + ' ' + row.entity + '/' + row.entityId + '/' + row.group +
      ' outcome=' + outcome.kind + ' attempt=' + attempts + ' settled=' + settled +
      ' durationMs=' + (Date.now() - started),
  );
  return settled ? result : 'skipped';
}

export async function drainSyncOutbox(options: DrainOptions = {}): Promise<DrainSummary> {
  const counts = { examined: 0, sent: 0, retry: 0, dead: 0, skipped: 0 };
  const transport = resolveTransport();
  if (!transport) return { configured: false, ...counts };

  const rows = (await loadDueRows(options.limit ?? DEFAULT_LIMIT))
    .slice()
    .sort((a, b) => groupRank(a.group) - groupRank(b.group));
  counts.examined = rows.length;
  if (rows.length === 0) return { configured: true, ...counts };

  let acknowledged: Map<string, number | null>;
  try {
    acknowledged = await fetchAcknowledged(
      transport,
      rows.map((row) => ({ entity: row.entity, entityId: row.entityId, group: row.group })),
    );
  } catch (error) {
    // Without the acknowledged revisions the H-R guard cannot run, so nothing is published.
    console.warn('[sync:drain] digest unavailable; deferring ' + rows.length + ' row(s): ' + message(error));
    counts.retry = rows.length;
    return { configured: true, ...counts };
  }

  const deadline = Date.now() + (options.budgetMs ?? DEFAULT_BUDGET_MS);
  for (const row of rows) {
    if (Date.now() >= deadline) break;
    counts[await processRow(row, transport, acknowledged)] += 1;
  }
  return { configured: true, ...counts };
}
