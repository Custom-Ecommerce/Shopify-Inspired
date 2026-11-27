import type { MobileStore } from '@markaz/contracts/mobile-data';
import { useSessionState, type KeyValueStore, type MobileRuntime } from '@markaz/mobile-kit';
import { storeQueryKey } from '@markaz/mobile-kit/core';
import { useQuery } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchStores } from './api';
import type { PushPort } from './push';

/** What the screens use: the runtime (client and session), the phone's storage, the push port. A test passes fakes. */
export interface Services {
  runtime: MobileRuntime;
  storage: KeyValueStore;
  appVersion: string;
  deviceName: string;
  /** The seller website, for the support link; null when this build was not given one. */
  portalUrl: string | null;
  push: PushPort;
}

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({ value, children }: { value: Services; children: ReactNode }) {
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices needs a ServicesProvider');
  return services;
}

export function useUserId(): string {
  return useSessionState(useServices().runtime).user?.id ?? '';
}

export interface StoreChoice {
  stores: MobileStore[];
  /** The store the screens are about; null while loading, or when the account has none. */
  store: MobileStore | null;
  select(storeId: string): void;
  loading: boolean;
  error: unknown;
  reload(): void;
}

const StoreContext = createContext<StoreChoice | null>(null);

export const selectedStoreKey = (userId: string): string => `markaz.store.${userId}`;

/** The chosen store, remembered per account. A remembered store that is gone gives way to the first one. */
export function StoreProvider({ children }: { children: ReactNode }) {
  const { runtime, storage } = useServices();
  const userId = useUserId();
  const [chosen, setChosen] = useState<string | null>(null);
  const [read, setRead] = useState(false);

  const query = useQuery({
    queryKey: ['user', userId, 'stores'],
    queryFn: async () => (await fetchStores(runtime.client)).stores,
    enabled: userId !== '',
  });

  useEffect(() => {
    let live = true;
    void storage.get(selectedStoreKey(userId)).then((id) => {
      if (!live) return;
      setChosen((current) => current ?? id);
      setRead(true);
    });
    return () => {
      live = false;
    };
  }, [storage, userId]);

  const select = useCallback(
    (storeId: string) => {
      setChosen(storeId);
      void storage.set(selectedStoreKey(userId), storeId);
    },
    [storage, userId],
  );

  const stores = useMemo(() => query.data ?? [], [query.data]);
  const store = read ? (stores.find((entry) => entry.id === chosen) ?? stores[0] ?? null) : null;
  const refetch = query.refetch;
  const loading = query.isPending || !read;
  const error = query.data ? null : query.error;

  const value = useMemo<StoreChoice>(
    () => ({ stores, store, select, loading, error, reload: () => void refetch() }),
    [stores, store, select, loading, error, refetch],
  );
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStoreChoice(): StoreChoice {
  const choice = useContext(StoreContext);
  if (!choice) throw new Error('useStoreChoice needs a StoreProvider');
  return choice;
}

/** The query key of something about the chosen store: another store, or another account, never sees it. */
export function useStoreKey(storeId: string): (...rest: unknown[]) => unknown[] {
  const userId = useUserId();
  return useCallback((...rest: unknown[]) => storeQueryKey(userId, storeId, ...rest), [userId, storeId]);
}
