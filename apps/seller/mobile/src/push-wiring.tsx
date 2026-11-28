import { useEffect, useRef } from 'react';
import { registerPushToken } from './api';
import { routeForPush } from './push';
import { useServices, useStoreChoice, useUserId } from './services';

/**
 * Registers this phone for push after sign-in, and opens what a tapped notification names. Renders nothing. A phone that cannot receive push (Expo Go,
 * permission refused) is simply left out; the settings screen says why.
 */
export function PushWiring({ open, delayMs = 2000 }: { open: (path: string) => void; delayMs?: number }) {
  const { runtime, push } = useServices();
  const { select, stores } = useStoreChoice();
  const userId = useUserId();
  // The handlers of the moment, without registering again when they change.
  const latest = useRef({ select, stores, open });
  const waiting = useRef<unknown>(null);

  useEffect(() => {
    latest.current = { select, stores, open };
  }, [select, stores, open]);

  useEffect(() => {
    if (!userId) return undefined;
    // Not during start: the first screen comes first.
    const timer = setTimeout(() => {
      void (async () => {
        const result = await push.register();
        if (result.ok) await registerPushToken(runtime.client, result.token);
      })().catch(() => {
        // Tried again at the next start; the app works without it.
      });
    }, delayMs);
    return () => clearTimeout(timer);
  }, [push, runtime, userId, delayMs]);

  const take = useRef((data: unknown) => {
    const target = routeForPush(data);
    if (!target) return;
    const { select: choose, stores: known, open: go } = latest.current;
    if (target.storeId) {
      // A tap can open the app: wait for the stores before choosing one. A store the account no longer has opens nothing.
      if (known.length === 0) {
        waiting.current = data;
        return;
      }
      if (!known.some((store) => store.id === target.storeId)) return;
      choose(target.storeId);
    }
    go(target.path);
  });

  useEffect(() => push.onTap((data) => take.current(data)), [push]);

  useEffect(() => {
    if (stores.length === 0 || waiting.current === null) return;
    const data = waiting.current;
    waiting.current = null;
    latest.current = { select, stores, open };
    take.current(data);
  }, [stores, select, open]);

  return null;
}
