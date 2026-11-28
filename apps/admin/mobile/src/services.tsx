import { effectiveAdminLevel, type AdminLevel } from '@markaz/auth/admin-levels';
import { useSessionState, type KeyValueStore, type MobileRuntime, type PushPort } from '@markaz/mobile-kit';
import { useQuery, type QueryKey } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { fetchMe } from './api';

/** What the screens use. A test passes fakes. */
export interface Services {
  runtime: MobileRuntime;
  storage: KeyValueStore;
  appVersion: string;
  deviceName: string;
  push: PushPort;
  recovery: RecoveryHolder;
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

/** A query key of the signed-in admin. */
export const adminKey = (userId: string, ...rest: unknown[]): unknown[] => ['user', userId, ...rest];

/**
 * What is written to the phone (T02): the overview, the orders and the admin's own level, so they open without a network. Payments, tickets and sellers are
 * never saved.
 */
export const PERSISTED_KINDS: readonly string[] = ['me', 'overview', 'orders', 'order'];
export const shouldPersistAdmin = (key: QueryKey): boolean => PERSISTED_KINDS.includes(String(key[2]));

/**
 * The admin's level: read from the server (a level can change), from the sign-in until that answers. It only decides what is shown; the server enforces.
 */
export function useAdminLevel(): AdminLevel | null {
  const { runtime } = useServices();
  const user = useSessionState(runtime).user;
  const userId = user?.id ?? '';
  const me = useQuery({ queryKey: adminKey(userId, 'me'), queryFn: () => fetchMe(runtime.client), enabled: userId !== '' });
  const level = me.data?.adminLevel ?? user?.adminLevel;
  return level === undefined ? null : effectiveAdminLevel(level);
}

/** The recovery codes of a first sign-in: in memory only, until the admin says they are saved. */
export interface RecoveryHolder {
  get(): readonly string[] | null;
  set(codes: readonly string[] | null): void;
  subscribe(listener: () => void): () => void;
}

export function createRecoveryHolder(): RecoveryHolder {
  let codes: readonly string[] | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => codes,
    set(next) {
      codes = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
