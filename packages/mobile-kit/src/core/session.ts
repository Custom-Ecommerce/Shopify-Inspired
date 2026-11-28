import type { AccessTokenSource, ApiClient } from './api-client';
import { ApiError, NetworkError } from './errors';
import type { SecretStore } from './storage';

/*
 * The signed-in state of one app (docs/mobile-api-v1.md). The rules that matter:
 *   - the refresh token lives in the secret store only; the access token in memory only
 *   - a refresh token works ONCE and using one twice ends the session, so there is never more than one refresh at a time and the new token is stored
 *     before anyone uses the new access token
 *   - a refused refresh (401) ends the session; no network, 426, 429 and 5xx keep it
 */

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role?: string;
  /** Admin app. */
  adminLevel?: string;
  capabilities?: string[];
}

export interface StoredSession {
  refreshToken: string;
  refreshTokenExpiresAt: string;
  deviceId: string;
  user: SessionUser;
}

export type SessionEndReason = 'signed_out' | 'revoked' | 'suspended';

export interface SessionState {
  status: 'signed_out' | 'signed_in';
  user: SessionUser | null;
  deviceId: string | null;
  /** Why the last session ended, for the sign-in screen. */
  endedBecause: SessionEndReason | null;
}

export interface SessionManagerOptions {
  /** /api/mobile/v1 or /api/admin/mobile/v1. */
  prefix: string;
  /** A client without a token source: sign-in, refresh and sign-out carry none. */
  client: ApiClient;
  secrets: SecretStore;
  storageKey: string;
  /** Called once for every ended session, before the listeners: clear the cached data and the queued changes of that user. */
  onEnded?: (userId: string, reason: SessionEndReason) => Promise<void> | void;
  now?: () => number;
}

export interface SignInAnswer {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  deviceId: string;
  user: SessionUser;
  adminLevel?: string;
  capabilities?: string[];
}

export interface SessionManager extends AccessTokenSource {
  getState(): SessionState;
  subscribe(listener: (state: SessionState) => void): () => void;
  /** Read the stored session at start. Needs no network. */
  restore(): Promise<SessionState>;
  /** The body of POST auth/login. The answer is returned so an admin app can show recovery codes. */
  signIn<T extends SignInAnswer = SignInAnswer>(body: unknown): Promise<T>;
  signOut(): Promise<void>;
}

type RefreshAnswer = Pick<SignInAnswer, 'accessToken' | 'accessTokenExpiresIn' | 'refreshToken' | 'refreshTokenExpiresAt'>;

/** Refresh a little before the server would refuse the token. */
const EARLY_MS = 30_000;

const unreadable = () => new ApiError({ status: 200, code: 'BAD_RESPONSE', message: 'The server sent an answer this app cannot read.' });

export function createSessionManager(options: SessionManagerOptions): SessionManager {
  const now = options.now ?? Date.now;
  let session: StoredSession | null = null;
  let access: { token: string; until: number } | null = null;
  let running: Promise<string | null> | null = null;
  /** Moves on every sign-in and sign-out, so a late refresh answer cannot bring an ended session back. */
  let generation = 0;
  let state: SessionState = { status: 'signed_out', user: null, deviceId: null, endedBecause: null };
  const listeners = new Set<(state: SessionState) => void>();

  function publish(endedBecause: SessionEndReason | null): void {
    state = session
      ? { status: 'signed_in', user: session.user, deviceId: session.deviceId, endedBecause: null }
      : { status: 'signed_out', user: null, deviceId: null, endedBecause };
    for (const listener of listeners) listener(state);
  }

  async function end(reason: SessionEndReason): Promise<void> {
    const userId = session?.user.id;
    generation += 1;
    session = null;
    access = null;
    await options.secrets.remove(options.storageKey);
    if (userId) await options.onEnded?.(userId, reason);
    publish(reason);
  }

  function take(answer: RefreshAnswer): string {
    access = { token: answer.accessToken, until: now() + answer.accessTokenExpiresIn * 1000 - EARLY_MS };
    return answer.accessToken;
  }

  async function runRefresh(): Promise<string | null> {
    const current = session;
    if (!current) return null;
    const started = generation;
    let answer: RefreshAnswer;
    try {
      answer = await options.client.request<RefreshAnswer>({
        method: 'POST',
        path: `${options.prefix}/auth/refresh`,
        body: { refreshToken: current.refreshToken },
        auth: false,
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        if (started === generation) await end(error.code === 'ACCOUNT_SUSPENDED' ? 'suspended' : 'revoked');
        return null;
      }
      throw error;
    }
    if (started !== generation) return null;
    if (typeof answer?.refreshToken !== 'string' || typeof answer.accessToken !== 'string') throw unreadable();
    session = { ...current, refreshToken: answer.refreshToken, refreshTokenExpiresAt: answer.refreshTokenExpiresAt };
    // Stored first: the old token is already used up.
    await options.secrets.set(options.storageKey, JSON.stringify(session));
    if (started !== generation) return null;
    return take(answer);
  }

  function oneRefresh(): Promise<string | null> {
    running ??= runRefresh().finally(() => {
      running = null;
    });
    return running;
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async restore() {
      const raw = await options.secrets.get(options.storageKey);
      if (raw) {
        try {
          const stored = JSON.parse(raw) as StoredSession;
          if (typeof stored.refreshToken === 'string' && typeof stored.user?.id === 'string') session = stored;
        } catch {
          session = null;
        }
        if (!session) await options.secrets.remove(options.storageKey);
      }
      publish(null);
      return state;
    },

    async signIn<T extends SignInAnswer>(body: unknown): Promise<T> {
      const answer = await options.client.request<T>({ method: 'POST', path: `${options.prefix}/auth/login`, body, auth: false });
      if (typeof answer?.refreshToken !== 'string' || typeof answer.user?.id !== 'string') throw unreadable();
      generation += 1;
      const user: SessionUser = { ...answer.user };
      if (answer.adminLevel) user.adminLevel = answer.adminLevel;
      if (answer.capabilities) user.capabilities = answer.capabilities;
      session = { refreshToken: answer.refreshToken, refreshTokenExpiresAt: answer.refreshTokenExpiresAt, deviceId: answer.deviceId, user };
      await options.secrets.set(options.storageKey, JSON.stringify(session));
      take(answer);
      publish(null);
      return answer;
    },

    async signOut() {
      // A refresh in flight would replace the token we are about to end.
      await running?.catch(() => null);
      const current = session;
      if (!current) return;
      await end('signed_out');
      try {
        await options.client.request({ method: 'POST', path: `${options.prefix}/auth/logout`, body: { refreshToken: current.refreshToken }, auth: false });
      } catch (error) {
        // The phone is signed out either way; the server's session expires or can be revoked from the devices list.
        if (!(error instanceof ApiError) && !(error instanceof NetworkError)) throw error;
      }
    },

    async accessToken() {
      if (!session) return null;
      if (access && access.until > now()) return access.token;
      return oneRefresh();
    },

    async refresh(staleToken) {
      if (!session) return null;
      // Someone else already got a newer one.
      if (access && access.token !== staleToken) return access.token;
      access = null;
      return oneRefresh();
    },
  };
}
