import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import type { ApiKeyScope, ApiV1ErrorCode } from '@markaz/contracts';
import { findApiKeyByPrefix, touchApiKey } from '@/lib/api-key-service';
import { checkApiKey, type ApiKeyRow } from '@/lib/api-keys';
import { limitApiKey } from '@/lib/api-rate-limit';
import { API_V1_LIMIT_DEFAULT, API_V1_LIMIT_MAX } from '@/lib/contracts';
import { connectSellerDb } from '@/lib/mongo';
import { loadEffectivePlan } from '@/lib/plan';
import { Store, User } from '@/lib/services';

/*
 * Sprint 8 (S8-B5, D-118): the ONE way into /api/v1. A v1 request is a KEY, never a user session: only the Authorization header is read (no cookie, no x-store-id),
 * and the store is the key's store, whatever the request says. The order, on every route:
 *
 *   1. the key is looked up (one lookup); an unknown, wrong, revoked or missing key is 401
 *   2. the rate limit of that key id (429 + Retry-After). It counts only requests that presented the key's secret, so knowing a key's public prefix is not enough to use up its limit
 *   3. the scope of the route (403 FORBIDDEN_SCOPE)
 *   4. the store (403 STORE_UNAVAILABLE when it is suspended, archived or gone, or its owner's account is not active)
 *   5. the owner's plan still includes API keys (403 PLAN_LIMIT_REACHED when limits.apiKeys is 0, e.g. after a subscription ran out)
 *   6. the query of the route
 *
 * A database failure anywhere is 503, never "invalid key". Errors are { error: { code, message } } and nothing in them depends on what was sent.
 */

export interface V1Caller {
  keyId: string;
  storeId: string;
}

const HEADERS = { 'Cache-Control': 'no-store' };

export function v1Json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: HEADERS });
}

export function v1Error(status: number, code: ApiV1ErrorCode, message: string, field?: string): NextResponse {
  return v1Json({ error: { code, message, ...(field === undefined ? {} : { field }) } }, status);
}

export const v1NotFound = (): NextResponse => v1Error(404, 'NOT_FOUND', 'Not found.');

const storeUnavailable = (): NextResponse => v1Error(403, 'STORE_UNAVAILABLE', 'The store of this API key is not available.');

/** The refusal of a key's store or plan, or null when the key may read. Throws on a database failure. */
async function refuseStore(storeId: string, now: Date): Promise<NextResponse | null> {
  const store = (await Store.findById(storeId).select('owner status archivedAt').lean()) as unknown as { owner?: unknown; status?: unknown; archivedAt?: unknown } | null;
  if (!store || !store.owner || store.status === 'suspended' || store.status === 'archived' || store.archivedAt) return storeUnavailable();
  const ownerId = String(store.owner);
  const owner = (await User.findById(ownerId).select('accountStatus').lean()) as unknown as { accountStatus?: unknown } | null;
  if (!owner || owner.accountStatus === 'suspended' || owner.accountStatus === 'blocked') return storeUnavailable();
  const plan = await loadEffectivePlan(ownerId, now);
  if (plan.limits.apiKeys === 0) return v1Error(403, 'PLAN_LIMIT_REACHED', 'The plan of this store no longer includes API keys.');
  return null;
}

async function admit(request: Request, scope: ApiKeyScope, now: Date): Promise<{ caller: V1Caller } | { refusal: NextResponse }> {
  await connectSellerDb();
  let row: ApiKeyRow | null = null;
  const checked = await checkApiKey(request.headers.get('authorization'), scope, {
    findByPrefix: async (prefix) => (row = await findApiKeyByPrefix(prefix)),
  });
  if (checked.status === 401) return { refusal: v1Json(checked.body, 401) };
  // Not 401, so the secret was right and the row is there, whether or not it has the scope.
  const keyId = String((row as unknown as ApiKeyRow)._id);
  const limited = await limitApiKey(keyId, now.getTime());
  if (limited !== null) return { refusal: limited };
  if (!checked.ok) return { refusal: v1Json(checked.body, checked.status) };
  const refusal = await refuseStore(checked.key.storeId, now);
  if (refusal !== null) return { refusal };
  await touchApiKey(checked.key.id, now);
  return { caller: { keyId: checked.key.id, storeId: checked.key.storeId } };
}

/** Runs a v1 GET: the checks above, then the read of this key's store. Anything that throws is a 503 with no detail. */
export async function v1Read(request: Request, scope: ApiKeyScope, read: (caller: V1Caller) => Promise<NextResponse>): Promise<NextResponse> {
  try {
    const admitted = await admit(request, scope, new Date());
    if ('refusal' in admitted) return admitted.refusal;
    return await read(admitted.caller);
  } catch (err) {
    console.error('[seller-backend] v1 request failed', err instanceof Error ? err.name : 'unknown');
    return v1Error(503, 'SERVICE_UNAVAILABLE', 'The service is temporarily unavailable. Try again.');
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Paging: newest first, by (createdAt, _id), which never change, so a record edited between two pages neither repeats nor disappears.

export interface V1ListQuery {
  limit: number;
  cursor: { createdAt: Date; id: string } | null;
  updatedSince: Date | null;
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

export const isV1Id = (value: unknown): value is string => typeof value === 'string' && OBJECT_ID.test(value) && mongoose.isValidObjectId(value);

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(createdAt.toISOString() + '|' + id, 'utf8').toString('base64url');
}

export function decodeCursor(value: string): { createdAt: Date; id: string } | null {
  if (value.length > 200 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const [at, id, ...rest] = Buffer.from(value, 'base64url').toString('utf8').split('|');
  if (rest.length > 0 || at === undefined || !isV1Id(id) || !ISO_INSTANT.test(at)) return null;
  const createdAt = new Date(at);
  return Number.isNaN(createdAt.getTime()) ? null : { createdAt, id };
}

/** limit, cursor and updatedSince. Anything else in the query (a "store" above all) is ignored. */
export function parseListQuery(params: URLSearchParams): { ok: true; query: V1ListQuery } | { ok: false; response: NextResponse } {
  const bad = (field: string, message: string) => ({ ok: false as const, response: v1Error(400, 'INVALID_REQUEST', message, field) });
  let limit = API_V1_LIMIT_DEFAULT;
  const rawLimit = params.get('limit') ?? '';
  if (rawLimit !== '') {
    limit = /^\d{1,3}$/.test(rawLimit) ? Number(rawLimit) : 0;
    if (limit < 1 || limit > API_V1_LIMIT_MAX) return bad('limit', 'limit must be a whole number from 1 to ' + API_V1_LIMIT_MAX + '.');
  }
  const rawCursor = params.get('cursor') ?? '';
  const cursor = rawCursor === '' ? null : decodeCursor(rawCursor);
  if (rawCursor !== '' && cursor === null) return bad('cursor', 'cursor must be the nextCursor of a previous page.');
  const rawSince = params.get('updatedSince') ?? '';
  let updatedSince: Date | null = null;
  if (rawSince !== '') {
    const at = ISO_INSTANT.test(rawSince) ? new Date(rawSince) : null;
    if (at === null || Number.isNaN(at.getTime())) return bad('updatedSince', 'updatedSince must be an ISO 8601 date and time with a time zone, for example 2026-11-01T00:00:00Z.');
    updatedSince = at;
  }
  return { ok: true, query: { limit, cursor, updatedSince } };
}

/** The filter of one page: `base` (which names the key's store) plus updatedSince and the position of the cursor. */
export function pageFilter(base: Record<string, unknown>, query: V1ListQuery): Record<string, unknown> {
  return {
    ...base,
    ...(query.updatedSince === null ? {} : { updatedAt: { $gte: query.updatedSince } }),
    ...(query.cursor === null
      ? {}
      : { $or: [{ createdAt: { $lt: query.cursor.createdAt } }, { createdAt: query.cursor.createdAt, _id: { $lt: query.cursor.id } }] }),
  };
}

export const PAGE_SORT = Object.freeze({ createdAt: -1, _id: -1 } as const);

/** Takes the rows read with limit + 1: the page, and the cursor of the next one (null on the last page). */
export function cutPage<T extends { _id: unknown; createdAt?: unknown }>(rows: T[], limit: number): { rows: T[]; nextCursor: string | null } {
  if (rows.length <= limit) return { rows, nextCursor: null };
  const page = rows.slice(0, limit);
  const last = page[page.length - 1]!;
  return { rows: page, nextCursor: encodeCursor(new Date(last.createdAt as Date), String(last._id)) };
}
