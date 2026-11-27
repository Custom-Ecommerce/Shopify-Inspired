import { useCallback, useRef } from 'react';
import { useServices } from './services';

/**
 * One Idempotency-Key per action: pressing "try again" for the same change sends the same key, so a change whose answer was lost is never made twice. A
 * different change, or a finished one, gets a new key.
 */
export function useActionKey() {
  const { runtime } = useServices();
  const held = useRef<{ action: string; key: string } | null>(null);
  const keyFor = useCallback(
    (action: unknown): string => {
      const signature = JSON.stringify(action);
      if (held.current?.action !== signature) held.current = { action: signature, key: runtime.newKey() };
      return held.current.key;
    },
    [runtime],
  );
  /** The server has answered: the next press is a new action. */
  const done = useCallback(() => {
    held.current = null;
  }, []);
  return { keyFor, done };
}
