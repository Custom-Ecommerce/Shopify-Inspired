import { useQueuedChanges, useSessionState } from '@markaz/mobile-kit';
import { ApiError, NetworkError, type NewChange, type QueuedChange } from '@markaz/mobile-kit/core';
import { onlineManager } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import { useServices } from './services';

/*
 * D-124: the three changes that may be made without a network (order status, order note, stock count). With a network and nothing waiting they are sent at
 * once; otherwise, or when no answer comes back, they wait in the queue and are sent in order.
 */

export type Outcome<T> = { kind: 'sent'; answer: T } | { kind: 'queued' };

export interface SubmitInput<T> {
  change: Omit<NewChange, 'idempotencyKey'>;
  /** The direct request, with the key to send. */
  send: (idempotencyKey: string) => Promise<T>;
}

export function useSubmit() {
  const { runtime } = useServices();
  // "Try again" after an answer such as a server fault is the same request: same key.
  const held = useRef<{ signature: string; key: string } | null>(null);

  return useCallback(
    async function submit<T>({ change, send }: SubmitInput<T>): Promise<Outcome<T>> {
      const queue = runtime.queue();
      if (!queue) throw new ApiError({ status: 401, message: 'Sign in again.' });
      await queue.load();
      const signature = JSON.stringify([change.storeId, change.change, change.revision]);
      if (held.current?.signature !== signature) held.current = { signature, key: runtime.newKey() };
      const { key } = held.current;

      // Anything already waiting goes first: the new change joins the line.
      if (!onlineManager.isOnline() || queue.list().length > 0) {
        await queue.enqueue(change);
        held.current = null;
        if (onlineManager.isOnline()) void queue.flush().catch(() => undefined);
        return { kind: 'queued' };
      }
      try {
        const answer = await send(key);
        held.current = null;
        return { kind: 'sent', answer };
      } catch (error) {
        if (error instanceof NetworkError) {
          // It may have reached the server: queued as the very same request, so it cannot happen twice.
          await queue.enqueue({ ...change, idempotencyKey: key });
          held.current = null;
          return { kind: 'queued' };
        }
        if (error instanceof ApiError && error.status < 500) held.current = null;
        throw error;
      }
    },
    [runtime],
  );
}

/** The waiting changes of the signed-in user, of one record when asked. */
export function usePending(filter?: (change: QueuedChange) => boolean): readonly QueuedChange[] {
  const { runtime } = useServices();
  useSessionState(runtime);
  const changes = useQueuedChanges(runtime);
  return filter ? changes.filter(filter) : changes;
}
