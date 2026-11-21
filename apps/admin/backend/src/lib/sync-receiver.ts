import { isStaleRevision } from '@markaz/sync-core';
import { SyncOutbox, StoreSyncRevision } from '@/lib/workspace';

/**
 * Sprint 6 EP-16 (S6-B7, D-106): the admin sync receiver under ONE shared database. It applies NO data. It records the highest acknowledged revision per
 * (store, group) (idempotent: a $max upsert, so a repeat or an older batch changes nothing), the digest says whether the sender is ok, behind or ahead, and
 * the repair requeues the missing range in the sender outbox. Written against ports so tests use a fake outbox.
 */

export const DEFAULT_GROUP = 'default';
export const REPAIR_RANGE_MAX = 1000;

export interface RevisionPort {
  load(store: string, group: string): Promise<number | null>;
  raise(store: string, group: string, revision: number, at: Date): Promise<void>;
}
export interface OutboxPort {
  /** Rows of this store and group in the revision range: how many exist, and how many were put back to pending (sent or dead only). */
  requeueRange(store: string, group: string, from: number, to: number, now: Date): Promise<{ found: number; requeued: number; alreadyPending: number }>;
}

export const realPorts: { revisions: RevisionPort; outbox: OutboxPort } = {
  revisions: {
    async load(store, group) {
      const row = (await StoreSyncRevision.findOne({ store, group } as never).select('revision').lean()) as { revision?: number } | null;
      return typeof row?.revision === 'number' ? row.revision : null;
    },
    async raise(store, group, revision, at) {
      // $max makes the write idempotent and order-proof: the stored revision only ever goes up.
      await StoreSyncRevision.updateOne({ store, group } as never, { $max: { revision }, $set: { receivedAt: at } } as never, { upsert: true });
    },
  },
  outbox: {
    async requeueRange(store, group, from, to, now) {
      const range = { entityId: store, group, revision: { $gte: from, $lte: to } };
      const found = await SyncOutbox.countDocuments(range as never);
      const alreadyPending = await SyncOutbox.countDocuments({ ...range, status: 'pending' } as never);
      const result = (await SyncOutbox.updateMany({ ...range, status: { $in: ['sent', 'dead'] } } as never, { $set: { status: 'pending', attempts: 0, nextAttemptAt: now, lastError: null } } as never)) as { modifiedCount?: number };
      return { found, requeued: result.modifiedCount ?? 0, alreadyPending };
    },
  },
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const revisionOk = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const keyOk = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= 64;

export interface ReceiveSummary {
  accepted: number;
  store: string;
  acknowledgedRevision: number;
  groups: Array<{ group: string; revision: number; stale: boolean }>;
  receivedAt: string;
}

/** Records the revisions of one batch. null when the shape is wrong (the route answers 422). Stale revisions (not newer than the stored one) are reported and ignored. */
export async function receiveBatch(payload: unknown, now: Date = new Date(), revisions: RevisionPort = realPorts.revisions): Promise<ReceiveSummary | null> {
  if (!isRecord(payload) || !keyOk(payload.store) || !revisionOk(payload.toRevision) || !Array.isArray(payload.events)) return null;
  const highest = new Map<string, number>();
  for (const event of payload.events) {
    if (!isRecord(event)) continue;
    const group = keyOk(event.group) ? event.group : keyOk(payload.group) ? payload.group : DEFAULT_GROUP;
    const revision = revisionOk(event.revision) ? event.revision : payload.toRevision;
    highest.set(group, Math.max(highest.get(group) ?? 0, revision));
  }
  if (highest.size === 0) highest.set(keyOk(payload.group) ? payload.group : DEFAULT_GROUP, payload.toRevision);
  const groups: ReceiveSummary['groups'] = [];
  for (const [group, revision] of highest) {
    const stored = await revisions.load(payload.store, group);
    const stale = isStaleRevision(revision, stored);
    if (!stale) await revisions.raise(payload.store, group, revision, now);
    groups.push({ group, revision, stale });
  }
  return { accepted: payload.events.length, store: payload.store, acknowledgedRevision: payload.toRevision, groups, receivedAt: now.toISOString() };
}

export type DigestStatus = 'ok' | 'behind' | 'ahead';
export function compareHeads(head: number, acknowledged: number | null): { status: DigestStatus; gap: number } {
  const ack = acknowledged ?? 0;
  if (head === ack) return { status: 'ok', gap: 0 };
  return head > ack ? { status: 'behind', gap: head - ack } : { status: 'ahead', gap: ack - head };
}

export async function digest(payload: unknown, now: Date = new Date(), revisions: RevisionPort = realPorts.revisions) {
  if (!isRecord(payload) || !keyOk(payload.store) || !revisionOk(payload.headRevision)) return null;
  const group = keyOk(payload.group) ? payload.group : DEFAULT_GROUP;
  const acknowledged = await revisions.load(payload.store, group);
  return { store: payload.store, group, headRevision: payload.headRevision, acknowledgedRevision: acknowledged, ...compareHeads(payload.headRevision, acknowledged), checkedAt: now.toISOString() };
}

export type RepairResult = { ok: true; body: Record<string, unknown> } | { ok: false; error: string };

/** Requeues the missing range. Never replays what is already acknowledged (the range starts after the acknowledged revision); a repeat requeues nothing new. */
export async function repair(payload: unknown, now: Date = new Date(), ports = realPorts): Promise<RepairResult> {
  if (!isRecord(payload) || !keyOk(payload.store) || !revisionOk(payload.fromRevision) || !revisionOk(payload.toRevision) || payload.fromRevision > payload.toRevision) return { ok: false, error: 'invalid repair request' };
  if (payload.toRevision - payload.fromRevision + 1 > REPAIR_RANGE_MAX) return { ok: false, error: 'the range is too long: at most ' + REPAIR_RANGE_MAX + ' revisions' };
  const group = keyOk(payload.group) ? payload.group : DEFAULT_GROUP;
  const acknowledged = await ports.revisions.load(payload.store, group);
  const from = Math.max(payload.fromRevision, acknowledged === null ? 0 : acknowledged + 1);
  const requested = { from: payload.fromRevision, to: payload.toRevision };
  if (from > payload.toRevision) return { ok: true, body: { store: payload.store, group, requested, replayFrom: null, requeued: 0, alreadyPending: 0, missing: 0, acknowledgedRevision: acknowledged } };
  const out = await ports.outbox.requeueRange(payload.store, group, from, payload.toRevision, now);
  return { ok: true, body: { store: payload.store, group, requested, replayFrom: from, requeued: out.requeued, alreadyPending: out.alreadyPending, missing: Math.max(0, payload.toRevision - from + 1 - out.found), acknowledgedRevision: acknowledged } };
}
