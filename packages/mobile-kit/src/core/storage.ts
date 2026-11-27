/** The two places an app keeps things. The phone adapters are in ../native; tests use the in-memory one. */

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/** Encrypted by the phone (Android Keystore). Small values only: the refresh token lives here and nowhere else. */
export type SecretStore = Pick<KeyValueStore, 'get' | 'set' | 'remove'>;

export function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async get(key) {
      return data.get(key) ?? null;
    },
    async set(key, value) {
      data.set(key, value);
    },
    async remove(key) {
      data.delete(key);
    },
    async keys() {
      return [...data.keys()];
    },
  };
}
