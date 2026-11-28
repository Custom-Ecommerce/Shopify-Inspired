import { useEffect, useRef } from 'react';
import { registerPushToken } from './api';
import { routeForAdminPush } from './push';
import { useServices, useUserId } from './services';

/** Registers this phone for push after sign-in and opens what a tapped notification names. Renders nothing. */
export function PushWiring({ open, delayMs = 2000 }: { open: (path: string) => void; delayMs?: number }) {
  const { runtime, push } = useServices();
  const userId = useUserId();
  const go = useRef(open);

  useEffect(() => {
    go.current = open;
  }, [open]);

  useEffect(() => {
    if (!userId) return undefined;
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

  useEffect(
    () =>
      push.onTap((data) => {
        const path = routeForAdminPush(data);
        if (path) go.current(path);
      }),
    [push],
  );

  return null;
}
