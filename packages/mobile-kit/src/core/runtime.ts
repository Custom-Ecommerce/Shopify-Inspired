import type { MOBILE_APPS } from '@markaz/contracts/mobile';
import { createApiClient, type ApiClient } from './api-client';
import type { UpgradeRequired } from './errors';
import { createIdempotencyKeyFactory } from './idempotency';
import { clearOtherUsers, clearUserData } from './offline/cache';
import { createOfflineQueue, type OfflineQueue, type QueuedChange } from './offline/queue';
import { createSessionManager, type SessionEndReason, type SessionManager } from './session';
import type { KeyValueStore, SecretStore } from './storage';

/*
 * The parts of an app put together, once: the client that carries the access token, the session behind it, and the offline queue of the signed-in user.
 * Pure: the phone adapters are passed in.
 */

export type MobileApp = (typeof MOBILE_APPS)[number];

export const API_PREFIX: Record<MobileApp, string> = { seller: '/api/mobile/v1', admin: '/api/admin/mobile/v1' };
export const INSTALLATION_KEY = 'markaz.installation';

export interface UpgradeNotice {
  minVersion: string | null;
  storeUrl: string | null;
}

export interface MobileRuntimeOptions {
  app: MobileApp;
  baseUrl: string;
  appVersion: string;
  secrets: SecretStore;
  storage: KeyValueStore;
  /** A UUID source. */
  random: () => string;
  fetch?: typeof fetch;
  /** Drop what is held in memory (the query cache) when a session ends. */
  onCacheClear?: () => void;
  onSent?: (item: QueuedChange, answer: unknown) => void;
}

export interface MobileRuntime {
  app: MobileApp;
  client: ApiClient;
  session: SessionManager;
  newKey: () => string;
  /** The queued changes of the signed-in user, or null. */
  queue(): OfflineQueue | null;
  upgrade(): UpgradeNotice | null;
  subscribeUpgrade(listener: () => void): () => void;
  /** The same id for every sign-in of this installation: signing in again replaces the old device entry. */
  installationId(): Promise<string>;
}

export function createMobileRuntime(options: MobileRuntimeOptions): MobileRuntime {
  const newKey = createIdempotencyKeyFactory(options.random);
  let queue: { userId: string; queue: OfflineQueue } | null = null;
  let notice: UpgradeNotice | null = null;
  const upgradeListeners = new Set<() => void>();

  const onUpgradeRequired = (error: UpgradeRequired) => {
    notice = { minVersion: error.minVersion, storeUrl: error.storeUrl };
    for (const listener of upgradeListeners) listener();
  };

  const shared = { baseUrl: options.baseUrl, appVersion: options.appVersion, fetch: options.fetch, onUpgradeRequired };
  const open = createApiClient(shared);

  async function onEnded(userId: string, _reason: SessionEndReason): Promise<void> {
    if (queue?.userId === userId) await queue.queue.clear();
    queue = null;
    options.onCacheClear?.();
    await clearUserData(options.storage, userId);
  }

  const session = createSessionManager({
    prefix: API_PREFIX[options.app],
    client: open,
    secrets: options.secrets,
    storageKey: `markaz.session.${options.app}`,
    onEnded,
  });
  const client = createApiClient({ ...shared, tokens: session });

  let signedInUser: string | null = null;
  session.subscribe((state) => {
    const userId = state.user?.id ?? null;
    if (userId && userId !== signedInUser) void clearOtherUsers(options.storage, userId);
    signedInUser = userId;
  });

  return {
    app: options.app,
    client,
    session,
    newKey,

    queue() {
      const userId = session.getState().user?.id;
      if (!userId) return null;
      if (queue?.userId !== userId) {
        queue = { userId, queue: createOfflineQueue({ userId, storage: options.storage, client, newKey, onSent: options.onSent }) };
      }
      return queue.queue;
    },

    upgrade: () => notice,

    subscribeUpgrade(listener) {
      upgradeListeners.add(listener);
      return () => {
        upgradeListeners.delete(listener);
      };
    },

    async installationId() {
      const stored = await options.storage.get(INSTALLATION_KEY);
      if (stored) return stored;
      const id = options.random();
      await options.storage.set(INSTALLATION_KEY, id);
      return id;
    },
  };
}
