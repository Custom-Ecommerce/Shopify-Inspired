/**
 * @markaz/sync-core: Payload-free sync primitives shared by both
 * receivers and the dispatcher. Persistence comes in through SyncPersistence;
 * each backend supplies its own adapter. The envelope shape mirrors
 * syncEnvelopeSchema in @markaz/platform-kit (the runtime validator).
 */


export const SYNC_SCHEMA_VERSION = 1 as const;


export type SyncSide = 'admin' | 'seller';
export type SyncOp = 'upsert';
export type SyncOutboxStatus = 'pending' | 'sent' | 'dead';


export interface SyncEnvelope<TData extends Record<string, unknown> = Record<string, unknown>> {
  schemaVersion: typeof SYNC_SCHEMA_VERSION;
  /** ULID. */
  eventId: string;
  source: SyncSide;
  entity: string;
  entityId: string;
  group: string;
  /** Monotonic per (entity, entityId, group), assigned by the system of record; >= 1. */
  revision: number;
  /** ISO 8601, informational only; never used for ordering. */
  occurredAt: string;
  op: SyncOp;
  data: TData;
  /** Lowercase SHA-256 hex of the canonical JSON of data. */
  dataHash: string;
}


/** A row of the sync-outbox collection as the dispatcher sees it. */
export interface OutboxRecord {
  eventId: string;
  target: SyncSide;
  entity: string;
  entityId: string;
  group: string;
  revision: number;
  payload: unknown;
  status: SyncOutboxStatus;
  attempts: number;
  nextAttemptAt?: Date | null;
  lastError?: string | null;
  sentAt?: Date | null;
}


/** Result of applying one envelope. 'stale' and 'duplicate' are not errors. */
export type SyncOutcome =
  | 'applied'
  | 'stale'
  | 'duplicate'
  | 'rejected'
  | 'failed';


export interface SyncItemResult {
  eventId: string;
  outcome: SyncOutcome;
  /** Present for 'rejected' and 'failed'. */
  reason?: string;
}


export interface SyncBatch {
  envelopes: readonly SyncEnvelope[];
}


export interface SyncBatchResult {
  results: SyncItemResult[];
  applied: number;
  stale: number;
  duplicate: number;
  rejected: number;
  failed: number;
}


/** Persistence port. Backends implement this; the core types import no database client; see mongoose-adapter.ts. */
export interface SyncPersistence {
  /** Last revision applied for the key, or null if none. */
  load(entity: string, entityId: string, group: string): Promise<number | null>;
  /** Record the applied revision and snapshot atomically. */
  save(envelope: SyncEnvelope): Promise<void>;
  /** Append a pending outbox row. */
  outboxWrite(record: Omit<OutboxRecord, 'status' | 'attempts'>): Promise<void>;
}


/** Applies one validated envelope. Throw to report 'failed'; return a SyncOutcome otherwise. */
export type SyncApplyHandler = (envelope: SyncEnvelope) => Promise<SyncOutcome>;


/**
 * Revision guard (H-R) as a pure function. An incoming revision that is not
 * newer than the stored one is stale. Callers must surface the stale outcome
 * rather than swallow it, so a reset admin database cannot silently discard
 * governance updates.
 */
export function isStaleRevision(incoming: number, stored: number | null): boolean {
  return stored !== null && incoming <= stored;
}


export function emptyBatchResult(): SyncBatchResult {
  return { results: [], applied: 0, stale: 0, duplicate: 0, rejected: 0, failed: 0 };
}


/**
 * Process a batch sequentially. One failing envelope never aborts the rest;
 * order inside the batch is preserved so revisions for one key apply in turn.
 */
export async function processBatch(
  batch: SyncBatch,
  apply: SyncApplyHandler,
): Promise<SyncBatchResult> {
  const summary = emptyBatchResult();


  for (const envelope of batch.envelopes) {
    let item: SyncItemResult;
    try {
      item = { eventId: envelope.eventId, outcome: await apply(envelope) };
    } catch (err) {
      item = {
        eventId: envelope.eventId,
        outcome: 'failed',
        reason: err instanceof Error ? err.message : String(err),
      };
    }
    summary.results.push(item);
    summary[item.outcome] += 1;
  }


  return summary;
}
export * from './mongoose-adapter';
export * from './outbox';
export * from './dispatcher';
