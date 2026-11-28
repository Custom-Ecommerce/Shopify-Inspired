import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { defaultShouldDehydrateQuery, QueryClient, type QueryKey } from '@tanstack/react-query';
import { ApiError } from '../core/errors';
import { CACHE_BUSTER, CACHE_MAX_AGE_MS, cacheStorageKey } from '../core/offline/cache';

/** A refusal is final; a lost connection or a server fault is worth two more tries. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status < 500) return false;
  return failureCount < 2;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // gcTime matches the persisted age: a screen opened this week still opens without a network.
      queries: { staleTime: 30_000, gcTime: CACHE_MAX_AGE_MS, retry: shouldRetry },
      mutations: { retry: false },
    },
  });
}

/**
 * The persisted cache of one user. `shouldPersist` narrows what is written to the phone; without it every successful answer is.
 */
export function persistOptionsFor(userId: string, shouldPersist?: (queryKey: QueryKey) => boolean) {
  return {
    ...(shouldPersist
      ? { dehydrateOptions: { shouldDehydrateQuery: (query: Parameters<typeof defaultShouldDehydrateQuery>[0]) => defaultShouldDehydrateQuery(query) && shouldPersist(query.queryKey) } }
      : {}),
    persister: createAsyncStoragePersister({ storage: AsyncStorage, key: cacheStorageKey(userId), throttleTime: 1000 }),
    maxAge: CACHE_MAX_AGE_MS,
    buster: CACHE_BUSTER,
  };
}
