import type { ApiClient, ApiRequest } from '../api-client';
import { ApiError, NetworkError, UpgradeRequired } from '../errors';
import type { KeyValueStore } from '../storage';
import { queueStorageKey } from './cache';

/*
 * D-124, the changing half, and it is ONE small feature: three kinds of change wait here and are sent in the order they were made.
 *
 *   - each change keeps its Idempotency-Key and the revision the user saw; a resend after a lost answer or a killed app is the same request
 *   - sending stops at the first change that cannot go: offline, a conflict (both values are kept for the user to choose) or a refusal
 *   - a later change to the same record, made on top of an earlier one, moves to the revision the earlier one produced, so a user does not conflict
 *     with themself
 */

export const MOBILE_V1 = '/api/mobile/v1';

export type OfflineChange =
  | { kind: 'order.status'; orderId: string; status: string; note?: string; courier?: string; trackingNumber?: string; trackingUrl?: string }
  | { kind: 'order.note'; orderId: string; text: string }
  | { kind: 'stock.count'; productId: string; variantId: string; quantity: number; reason?: string };

export type QueuedState = 'pending' | 'conflict' | 'failed';

export interface QueuedChange {
  id: string;
  storeId: string;
  change: OfflineChange;
  /** The revision of the record as the user saw it. */
  revision: number;
  idempotencyKey: string;
  createdAt: string;
  state: QueuedState;
  /** It has been sent at least once: its body must not change any more. */
  attempted: boolean;
  /** For the Pending changes screen: what it is about. */
  label: string;
  /** What the user saw before the change. */
  seen?: unknown;
  /** conflict: the record as the server has it now. */
  current?: unknown;
  problem?: { status: number; code: string | null; message: string };
}

export type StopReason = 'offline' | 'busy' | 'server' | 'signed_out' | 'upgrade' | 'conflict' | 'failed';

export interface FlushResult {
  sent: QueuedChange[];
  /** null: everything that was waiting has gone. */
  stopped: StopReason | null;
}

export interface NewChange {
  storeId: string;
  change: OfflineChange;
  revision: number;
  label: string;
  seen?: unknown;
  /** The key of a request that was already sent but got no answer: the queued change is that same request. */
  idempotencyKey?: string;
}

export interface OfflineQueueOptions {
  userId: string;
  storage: KeyValueStore;
  client: ApiClient;
  newKey: () => string;
  now?: () => Date;
  /** After a change reached the server: refresh the screens that show the record. */
  onSent?: (item: QueuedChange, answer: unknown) => void;
}

export interface OfflineQueue {
  load(): Promise<void>;
  list(): readonly QueuedChange[];
  subscribe(listener: () => void): () => void;
  enqueue(input: NewChange): Promise<QueuedChange>;
  flush(): Promise<FlushResult>;
  /** Send my change anyway, on top of what the server has now (conflict), or try a refused change again. */
  keepMine(id: string): Promise<void>;
  /** Drop the change: the server's value stays. */
  discard(id: string): Promise<void>;
  clear(): Promise<void>;
}

export const recordKey = (change: OfflineChange): string => (change.kind === 'stock.count' ? `product:${change.productId}` : `order:${change.orderId}`);

/** The request of a queued change. The same item always gives the same request. */
export function requestFor(item: QueuedChange): ApiRequest {
  const { change, revision, storeId, idempotencyKey } = item;
  const base = { method: 'POST' as const, storeId, idempotencyKey };
  if (change.kind === 'order.status') {
    const { status, note, courier, trackingNumber, trackingUrl } = change;
    return { ...base, path: `${MOBILE_V1}/orders/${change.orderId}/status`, body: { revision, status, note, courier, trackingNumber, trackingUrl } };
  }
  if (change.kind === 'order.note') {
    return { ...base, path: `${MOBILE_V1}/orders/${change.orderId}/notes`, body: { revision, text: change.text } };
  }
  const { variantId, quantity, reason } = change;
  return { ...base, path: `${MOBILE_V1}/products/${change.productId}/stock`, body: { revision, variantId, quantity, reason } };
}

/** The record's revision in a write's answer, { order } or { product }; null when it must not be carried to later changes. */
function revisionIn(change: OfflineChange, answer: unknown): number | null {
  const body = (answer ?? {}) as { changed?: boolean; order?: { revision?: unknown }; product?: { revision?: unknown } };
  // changed:false means nothing was written: the record may have moved for another reason, so later changes keep what the user saw.
  if (body.changed === false) return null;
  const revision = change.kind === 'stock.count' ? body.product?.revision : body.order?.revision;
  return typeof revision === 'number' ? revision : null;
}

function stopFor(error: unknown): StopReason {
  if (error instanceof NetworkError) return 'offline';
  if (error instanceof UpgradeRequired) return 'upgrade';
  if (!(error instanceof ApiError)) return 'offline';
  if (error.status === 401) return 'signed_out';
  if (error.status === 409 && error.code === 'CONFLICT') return 'conflict';
  if (error.status === 409 && error.code === 'IDEMPOTENCY_IN_PROGRESS') return 'busy';
  if (error.status === 408 || error.status === 429 || error.status >= 500) return 'server';
  return 'failed';
}

export function createOfflineQueue(options: OfflineQueueOptions): OfflineQueue {
  const storageKey = queueStorageKey(options.userId);
  const now = options.now ?? (() => new Date());
  let items: QueuedChange[] = [];
  let loading: Promise<void> | null = null;
  let flushing: Promise<FlushResult> | null = null;
  let writes: Promise<void> = Promise.resolve();
  /** Moves on clear(), so an answer that arrives later changes nothing. */
  let generation = 0;
  const listeners = new Set<() => void>();
  const announce = () => {
    for (const listener of listeners) listener();
  };

  function load(): Promise<void> {
    loading ??= (async () => {
      const raw = await options.storage.get(storageKey);
      if (!raw) return;
      try {
        const stored: unknown = JSON.parse(raw);
        if (Array.isArray(stored)) items = stored as QueuedChange[];
      } catch {
        // An unreadable queue cannot be sent; start clean rather than send something half written.
        await options.storage.remove(storageKey);
      }
      announce();
    })();
    return loading;
  }

  /** One change of the list at a time, saved before anyone relies on it. */
  function update(change: (current: QueuedChange[]) => QueuedChange[]): Promise<void> {
    const next = writes.then(async () => {
      items = change(items);
      if (items.length) await options.storage.set(storageKey, JSON.stringify(items));
      else await options.storage.remove(storageKey);
      announce();
    });
    writes = next.catch(() => undefined);
    return next;
  }

  const patch = (id: string, values: Partial<QueuedChange>) => update((all) => all.map((item) => (item.id === id ? { ...item, ...values } : item)));

  async function run(): Promise<FlushResult> {
    await load();
    const started = generation;
    const sent: QueuedChange[] = [];
    for (;;) {
      const head = items[0];
      if (!head) return { sent, stopped: null };
      if (head.state !== 'pending') return { sent, stopped: head.state };

      await patch(head.id, { attempted: true });
      const item = items.find((entry) => entry.id === head.id);
      if (!item) continue;

      let answer: unknown;
      try {
        answer = await options.client.request(requestFor(item));
      } catch (error) {
        if (started !== generation) return { sent, stopped: 'signed_out' };
        const stopped = stopFor(error);
        if (stopped === 'conflict' || stopped === 'failed') {
          const refusal = error as ApiError;
          await patch(item.id, {
            state: stopped,
            current: stopped === 'conflict' ? (refusal.body as { current?: unknown } | null)?.current : undefined,
            problem: { status: refusal.status, code: refusal.code, message: refusal.message },
          });
        }
        return { sent, stopped };
      }
      if (started !== generation) return { sent, stopped: 'signed_out' };

      const revision = revisionIn(item.change, answer);
      const record = recordKey(item.change);
      await update((all) =>
        all
          .filter((entry) => entry.id !== item.id)
          .map((entry) =>
            revision !== null && !entry.attempted && entry.storeId === item.storeId && recordKey(entry.change) === record && entry.revision === item.revision
              ? { ...entry, revision }
              : entry,
          ),
      );
      sent.push(item);
      options.onSent?.(item, answer);
    }
  }

  return {
    load,
    list: () => items,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async enqueue(input) {
      await load();
      const idempotencyKey = input.idempotencyKey ?? options.newKey();
      const item: QueuedChange = {
        id: idempotencyKey,
        storeId: input.storeId,
        change: input.change,
        revision: input.revision,
        label: input.label,
        seen: input.seen,
        idempotencyKey,
        createdAt: now().toISOString(),
        state: 'pending',
        // Already sent once: its body must stay as it was.
        attempted: input.idempotencyKey !== undefined,
      };
      await update((all) => [...all, item]);
      return item;
    },

    flush() {
      flushing ??= run().finally(() => {
        flushing = null;
      });
      return flushing;
    },

    async keepMine(id) {
      await load();
      const item = items.find((entry) => entry.id === id);
      if (!item || item.state === 'pending') return;
      const current = (item.current ?? null) as { revision?: unknown } | null;
      // The server keeps a refusal under the old key: a new attempt is a new request.
      await patch(id, {
        state: 'pending',
        attempted: false,
        idempotencyKey: options.newKey(),
        revision: typeof current?.revision === 'number' ? current.revision : item.revision,
        seen: item.state === 'conflict' ? item.current : item.seen,
        current: undefined,
        problem: undefined,
      });
    },

    async discard(id) {
      await load();
      await update((all) => all.filter((entry) => entry.id !== id));
    },

    async clear() {
      generation += 1;
      loading = Promise.resolve();
      await update(() => []);
    },
  };
}
