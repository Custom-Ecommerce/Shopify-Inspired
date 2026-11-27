import { IsRestoringProvider, QueryClientProvider, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { MobileRuntime, UpgradeNotice } from '../core/runtime';
import type { SessionState } from '../core/session';
import { persistOptionsFor } from './query';

/**
 * The query cache: saved to the phone while somebody is signed in, in memory only otherwise. The element tree is the same in both cases, so signing in or
 * out never remounts the navigator under it. While the saved cache is being read, queries wait.
 */
export function QueryProvider({
  client,
  userId,
  shouldPersist,
  children,
}: {
  client: QueryClient;
  userId: string | null;
  /** Which answers may be written to the phone (all, when left out). Must be the same function every time. */
  shouldPersist?: (queryKey: QueryKey) => boolean;
  children: ReactNode;
}) {
  const [restoredFor, setRestoredFor] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return undefined;
    let live = true;
    const [stop, restored] = persistQueryClient({ queryClient: client, ...persistOptionsFor(userId, shouldPersist) });
    // An unreadable saved cache is discarded by the library; the app goes on with the network.
    void restored
      .catch(() => undefined)
      .then(() => {
        if (live) setRestoredFor(userId);
      });
    return () => {
      live = false;
      stop();
      setRestoredFor(null);
    };
  }, [client, userId, shouldPersist]);

  return (
    <IsRestoringProvider value={userId !== null && restoredFor !== userId}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </IsRestoringProvider>
  );
}

export function useSessionState(runtime: MobileRuntime): SessionState {
  return useSyncExternalStore(runtime.session.subscribe, runtime.session.getState);
}

export function useUpgradeNotice(runtime: MobileRuntime): UpgradeNotice | null {
  return useSyncExternalStore(runtime.subscribeUpgrade, runtime.upgrade);
}
