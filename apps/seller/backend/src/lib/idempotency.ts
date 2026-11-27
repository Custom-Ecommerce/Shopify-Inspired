import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { AuthContext } from '@/lib/auth';
import { MOBILE_IDEMPOTENCY_HEADER, MOBILE_IDEMPOTENCY_KEY_PATTERN, MOBILE_IDEMPOTENCY_TTL_DAYS, MOBILE_WRITE_CODES } from '@/lib/contracts';
import { HttpError, isDuplicateKeyError, jsonError } from '@/lib/http';
import { IdempotencyRecord } from '@/lib/services';

/*
 * Sprint 9 (EP-31.US03.T02): the Idempotency-Key of every phone write. The unique {user, key} insert decides who does the work:
 *
 *   first request            runs the write; its answer is stored
 *   same key, same request   the stored answer again (header Idempotent-Replay: true); while it is still running: 409 IDEMPOTENCY_IN_PROGRESS
 *   same key, other request  422 IDEMPOTENCY_KEY_REUSED
 *
 * An answer that may be different next time (401, 403, 429, 5xx, a thrown error) is not kept: the row is removed and a retry runs again. A row left
 * 'pending' by a process that died is taken over after a minute. That cannot apply a change twice: every write it guards is a compare-and-set on the
 * revision, which the first run moved if it got that far.
 */

export const IDEMPOTENCY_STALE_MS = 60_000;
const KEPT_STATUSES = new Set([200, 201, 400, 404, 409, 422]);

export interface IdempotencyRow {
  requestHash: string;
  state: 'pending' | 'done';
  responseStatus: number | null;
  responseBody: unknown;
  startedAt: Date;
}

export interface IdempotencyStore {
  /** False when {user, key} exists already. */
  claim(user: string, key: string, route: string, requestHash: string, now: Date): Promise<boolean>;
  find(user: string, key: string): Promise<IdempotencyRow | null>;
  /** Takes over a pending row that started before `startedBefore`: one caller wins. */
  takeOver(user: string, key: string, startedBefore: Date, now: Date): Promise<boolean>;
  finish(user: string, key: string, status: number, body: unknown): Promise<void>;
  release(user: string, key: string): Promise<void>;
}

const model = IdempotencyRecord as any;

const databaseStore: IdempotencyStore = {
  async claim(user, key, route, requestHash, now) {
    try {
      await model.create({ user, key, route, requestHash, state: 'pending', startedAt: now, expiresAt: new Date(now.getTime() + MOBILE_IDEMPOTENCY_TTL_DAYS * 86_400_000) });
      return true;
    } catch (err) {
      if (isDuplicateKeyError(err)) return false;
      throw err;
    }
  },
  async find(user, key) {
    return (await model.findOne({ user, key }).select('requestHash state responseStatus responseBody startedAt').lean()) as unknown as IdempotencyRow | null;
  },
  async takeOver(user, key, startedBefore, now) {
    const result = await model.updateOne({ user, key, state: 'pending', startedAt: { $lt: startedBefore } }, { $set: { startedAt: now } });
    return result.modifiedCount === 1;
  },
  async finish(user, key, status, body) {
    await model.updateOne({ user, key }, { $set: { state: 'done', responseStatus: status, responseBody: body } });
  },
  async release(user, key) {
    await model.deleteOne({ user, key, state: 'pending' });
  },
};

let store: IdempotencyStore = databaseStore;

/** Test seam. Pass null to go back to the database. */
export function setIdempotencyStore(next: IdempotencyStore | null): void {
  store = next ?? databaseStore;
}

/** JSON with object keys sorted, so the same body in another order is the same request. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return '{' + Object.keys(row).filter((k) => row[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonical(row[k])).join(',') + '}';
  }
  return JSON.stringify(value ?? null);
}

/** 400 IDEMPOTENCY_KEY_REQUIRED unless the request carries a usable key. */
export function requireIdempotencyKey(headers: Headers): string {
  const key = headers.get(MOBILE_IDEMPOTENCY_HEADER)?.trim() ?? '';
  if (!MOBILE_IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new HttpError(400, 'Send an Idempotency-Key header (8 to 128 letters, digits, - or _).', MOBILE_WRITE_CODES.KEY_REQUIRED, MOBILE_IDEMPOTENCY_HEADER);
  }
  return key;
}

/**
 * Runs `work` once for this user and key. `request` is everything that makes the write what it is (store, record, body). `work` answers the response; it
 * turns its own expected errors into responses.
 */
export async function idempotently(ctx: AuthContext, key: string, route: string, request: unknown, work: () => Promise<Response>): Promise<Response> {
  const requestHash = createHash('sha256').update(route + '\n' + canonical(request)).digest('hex');
  const now = new Date();
  const user = ctx.userId;

  if (!(await store.claim(user, key, route, requestHash, now))) {
    const row = await store.find(user, key);
    // Released between our insert and this read: tell the app to send it again.
    if (!row) return jsonError(409, 'This request is still being worked on. Send it again shortly.', MOBILE_WRITE_CODES.IN_PROGRESS);
    if (row.requestHash !== requestHash) return jsonError(422, 'This Idempotency-Key was already used for another request.', MOBILE_WRITE_CODES.KEY_REUSED);
    if (row.state === 'done') {
      return NextResponse.json(row.responseBody, { status: row.responseStatus ?? 200, headers: { 'Cache-Control': 'no-store', 'Idempotent-Replay': 'true' } });
    }
    if (!(await store.takeOver(user, key, new Date(now.getTime() - IDEMPOTENCY_STALE_MS), now))) {
      return jsonError(409, 'This request is still being worked on. Send it again shortly.', MOBILE_WRITE_CODES.IN_PROGRESS);
    }
  }

  let response: Response;
  try {
    response = await work();
  } catch (err) {
    await store.release(user, key).catch(() => undefined);
    throw err;
  }
  try {
    if (KEPT_STATUSES.has(response.status)) await store.finish(user, key, response.status, await response.clone().json());
    else await store.release(user, key);
  } catch (err) {
    // The work is done; only the memory of it failed. A repeat finds a pending row, takes it over later and meets the moved revision.
    console.error('[seller-backend] could not keep an idempotent answer', { route, error: err instanceof Error ? err.message : 'unknown' });
  }
  return response;
}
