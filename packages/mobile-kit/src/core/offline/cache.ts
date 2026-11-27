import type { KeyValueStore } from '../storage';

/*
 * D-124, the reading half. The query cache is saved per user; every store query key starts with the user and the store, so one store never shows another's
 * data. The cache and the queued changes of a user are removed when their session ends (sign-out, revoked device, suspension).
 */

const PREFIX = 'markaz.';
/** Bump when a cached shape stops being readable. */
export const CACHE_BUSTER = 'v1';
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const cacheStorageKey = (userId: string): string => `${PREFIX}cache.${userId}`;
export const queueStorageKey = (userId: string): string => `${PREFIX}queue.${userId}`;

/** The start of every query key about a store. */
export function storeQueryKey(userId: string, storeId: string, ...rest: unknown[]): unknown[] {
  return ['user', userId, 'store', storeId, ...rest];
}

export async function clearUserData(storage: KeyValueStore, userId: string): Promise<void> {
  await storage.remove(cacheStorageKey(userId));
  await storage.remove(queueStorageKey(userId));
}

/** After a sign-in: nothing of an earlier account stays on the phone. */
export async function clearOtherUsers(storage: KeyValueStore, userId: string): Promise<void> {
  const keep = new Set([cacheStorageKey(userId), queueStorageKey(userId)]);
  for (const key of await storage.keys()) {
    if ((key.startsWith(`${PREFIX}cache.`) || key.startsWith(`${PREFIX}queue.`)) && !keep.has(key)) await storage.remove(key);
  }
}
