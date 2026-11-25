import mongoose from 'mongoose';
import type { ApiKeyCreateResponse, ApiKeyListResponse, ApiKeyView } from '@markaz/contracts';
import { generateApiKey, publicApiKeyPrefix, type ApiKeyRow } from '@/lib/api-keys';
import { API_KEY_ERROR_CODES } from '@/lib/contracts';
import { HttpError, isDuplicateKeyError } from '@/lib/http';
import { assertWithinPlan, canCheckPlans, loadEffectivePlan, ownerOfStore } from '@/lib/plan';
import { ApiKey, writeAuditLog } from '@/lib/services';

/*
 * Sprint 8 (S8-B4, D-118): the database side of a store's API keys (kept out of the route files). Owner only. The secret leaves createStoreApiKey in its return value
 * and nowhere else: it is not stored (only its hash is), not logged, not audited and in no error. No answer carries the hash (it is select:false and never read here
 * except by the check lookup).
 */

type Row = Record<string, any>;

const notFound = (): HttpError => new HttpError(404, 'API key not found', API_KEY_ERROR_CODES.API_KEY_NOT_FOUND);

const iso = (value: unknown): string | null => (value instanceof Date ? value.toISOString() : typeof value === 'string' && value !== '' ? value : null);

/** One key as the owner reads it, built field by field: nothing else of the row (the hash above all) can reach an answer. */
export function toApiKeyView(row: Row): ApiKeyView {
  return {
    id: String(row._id),
    name: String(row.name ?? ''),
    prefix: publicApiKeyPrefix(String(row.prefix ?? '')),
    scopes: Array.isArray(row.scopes) ? row.scopes.map(String) as ApiKeyView['scopes'] : [],
    lastUsedAt: iso(row.lastUsedAt),
    createdAt: iso(row.createdAt) ?? new Date(0).toISOString(),
    revokedAt: iso(row.revokedAt),
  };
}

export interface ApiKeyActor {
  userObjectId: mongoose.Types.ObjectId;
  /** The actor string of the audit log (auditActorOf). */
  auditActor: string;
  role: string;
}

async function audit(action: string, storeId: string, actor: ApiKeyActor, details: Record<string, unknown>): Promise<void> {
  try {
    await writeAuditLog(action, 'store', storeId, actor.auditActor, { actorRole: actor.role, ...details, at: new Date().toISOString() });
  } catch (err) {
    console.error('[seller-backend] could not write the API key audit entry', err instanceof Error ? err.name : 'unknown');
  }
}

const PREFIX_ATTEMPTS = 3;

/** Makes a key after the plan allows one more (403 PLAN_LIMIT_REACHED; live keys of the store count, revoked ones do not). The full secret is in the return value ONCE. */
export async function createStoreApiKey(storeId: string, actor: ApiKeyActor, body: { name: string; scopes: string[] }, now: Date = new Date()): Promise<ApiKeyCreateResponse> {
  const ownerId = await ownerOfStore(storeId);
  if (ownerId === null) throw new HttpError(404, 'Store not found');
  await assertWithinPlan({ kind: 'apiKeys', ownerId, storeId, adding: 1, now });

  for (let attempt = 1; ; attempt += 1) {
    const generated = generateApiKey();
    try {
      const created = (await ApiKey.create({
        store: storeId,
        name: body.name,
        prefix: generated.prefix,
        hash: generated.hash,
        scopes: body.scopes,
        createdBy: actor.userObjectId,
        lastUsedAt: null,
        revokedAt: null,
        revision: 0,
      } as never)) as unknown as Row;
      const row = typeof created.toObject === 'function' ? created.toObject() : created;
      await audit('api_key.create', storeId, actor, { keyId: String(row._id), name: body.name, prefix: publicApiKeyPrefix(generated.prefix), scopes: body.scopes });
      return { key: toApiKeyView(row), secret: generated.token };
    } catch (err) {
      // Two keys with the same 8 hex characters: take another prefix.
      if (isDuplicateKeyError(err) && attempt < PREFIX_ATTEMPTS) continue;
      throw err;
    }
  }
}

export async function listStoreApiKeys(storeId: string, now: Date = new Date()): Promise<ApiKeyListResponse> {
  const rows = (await ApiKey.find({ store: storeId } as never).sort({ createdAt: -1 }).lean()) as unknown as Row[];
  const ownerId = await ownerOfStore(storeId);
  const limit = ownerId !== null && canCheckPlans() ? (await loadEffectivePlan(ownerId, now)).limits.apiKeys : null;
  return { keys: rows.map(toApiKeyView), usage: { used: rows.filter((row) => !row.revokedAt).length, limit } };
}

/**
 * Revokes a key of this store: ONE compare-and-set on { revokedAt: null }, so it takes effect at once and frees the plan slot. Revoking a revoked key answers it
 * unchanged (idempotent, no second audit entry). A key of another store is a 404.
 */
export async function revokeStoreApiKey(storeId: string, actor: ApiKeyActor, keyId: string, now: Date = new Date()): Promise<ApiKeyView> {
  if (!mongoose.isValidObjectId(keyId)) throw notFound();
  const current = (await ApiKey.findOne({ _id: keyId, store: storeId } as never).lean()) as unknown as Row | null;
  if (!current) throw notFound();
  if (current.revokedAt) return toApiKeyView(current);
  const updated = (await ApiKey.findOneAndUpdate(
    { _id: keyId, store: storeId, revokedAt: null } as never,
    { $set: { revokedAt: now }, $inc: { revision: 1 } } as never,
    { new: true },
  ).lean()) as unknown as Row | null;
  if (!updated) {
    // Another request revoked it between the read and the write.
    const again = (await ApiKey.findOne({ _id: keyId, store: storeId } as never).lean()) as unknown as Row | null;
    if (!again) throw notFound();
    return toApiKeyView(again);
  }
  await audit('api_key.revoke', storeId, actor, { keyId, name: updated.name ?? null, prefix: publicApiKeyPrefix(String(updated.prefix ?? '')) });
  return toApiKeyView(updated);
}

/** The lookup checkApiKey uses (the only read of the hash). */
export async function findApiKeyByPrefix(prefix: string): Promise<ApiKeyRow | null> {
  return (await ApiKey.findOne({ prefix } as never).select('store scopes revokedAt +hash').lean()) as unknown as ApiKeyRow | null;
}

/** Notes that a key was used (the owner sees it). Best effort: a failure never fails the request. */
export async function touchApiKey(keyId: string, now: Date = new Date()): Promise<void> {
  try {
    await ApiKey.updateOne({ _id: keyId, revokedAt: null } as never, { $set: { lastUsedAt: now } } as never);
  } catch (err) {
    console.error('[seller-backend] could not note the use of an API key', err instanceof Error ? err.name : 'unknown');
  }
}
