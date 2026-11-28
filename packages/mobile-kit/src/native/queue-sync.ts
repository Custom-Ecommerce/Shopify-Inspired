import { onlineManager } from '@tanstack/react-query';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import type { OfflineQueue, QueuedChange } from '../core/offline/queue';
import type { MobileRuntime } from '../core/runtime';

/** How long after start the first send waits, so it does not slow the first screen. */
export const FIRST_SEND_DELAY_MS = 1500;
/** The phone can be "online" while the server cannot be reached: try again now and then while something waits. */
export const RETRY_EVERY_MS = 30_000;

const NOTHING: readonly QueuedChange[] = [];

/** The changes waiting to be sent, of the signed-in user. */
export function useQueuedChanges(runtime: MobileRuntime): readonly QueuedChange[] {
  const queue = runtime.queue();
  const subscribe = useCallback((listener: () => void) => queue?.subscribe(listener) ?? (() => undefined), [queue]);
  const changes = useSyncExternalStore(subscribe, () => queue?.list() ?? NOTHING);
  useEffect(() => {
    void queue?.load();
  }, [queue]);
  return changes;
}

const send = (queue: OfflineQueue | null) => {
  // A failure leaves the change queued; the next trigger tries again.
  if (queue && onlineManager.isOnline()) void queue.flush().catch(() => undefined);
};

/** Sends the queued changes at start, when the network returns, when the app comes back to the front, and every while something waits. */
export function useQueueSync(runtime: MobileRuntime): void {
  const userId = runtime.session.getState().user?.id ?? null;
  const waiting = useQueuedChanges(runtime).some((change) => change.state === 'pending');

  useEffect(() => {
    if (!userId) return undefined;
    const trigger = () => send(runtime.queue());
    const first = setTimeout(trigger, FIRST_SEND_DELAY_MS);
    const stopOnline = onlineManager.subscribe((online) => {
      if (online) trigger();
    });
    const front = AppState.addEventListener('change', (state) => {
      if (state === 'active') trigger();
    });
    return () => {
      clearTimeout(first);
      stopOnline();
      front.remove();
    };
  }, [runtime, userId]);

  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(() => send(runtime.queue()), RETRY_EVERY_MS);
    return () => clearInterval(timer);
  }, [runtime, waiting]);
}
