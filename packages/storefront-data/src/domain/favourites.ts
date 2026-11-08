import type { StorefrontProductSummary } from "../transport/types";

/*
 * A shopper's favourites: product ids in this browser, one list per store. Ids only, never a variant or a price, so a list
 * cannot go stale about anything but whether the product is still Live. Pure apart from the storage it is handed.
 */

/** Raise this and teach readIds the old shape if the stored format ever changes. */
export const FAVOURITES_STORAGE_VERSION = 1;
export const FAVOURITES_MAX = 200;
/** What the products route accepts per call. */
export const FAVOURITES_PAGE_SIZE = 48;

const KEY_PREFIX = "markaz-favourites:";

/** The demo storefront's list. A store with a key gets its own. */
export const DEMO_FAVOURITES_KEY = KEY_PREFIX + "demo";

export function favouritesKey(storeKey: string): string {
  return KEY_PREFIX + storeKey;
}

/** A draft or sample product seen in a preview is not something a shopper can come back to, so it has no heart. */
export function canFavourite(previewLabel: string | null | undefined): boolean {
  return !previewLabel;
}

export type FavouritesStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface FavouritesStore {
  /** A stable reference until the list changes, as useSyncExternalStore needs. */
  getIds: () => readonly string[];
  subscribe: (listener: () => void) => () => void;
  /** False when the list is full, so a heart does not claim a save that did not happen. */
  add: (productId: string) => boolean;
  remove: (productId: string) => void;
  /** Whether the product is a favourite afterwards. */
  toggle: (productId: string) => boolean;
  /** Takes these ids off the list: products that are no longer Live. */
  prune: (productIds: readonly string[]) => void;
  clear: () => void;
}

export const NO_FAVOURITES: readonly string[] = Object.freeze([]);

/** Anything that is not this version's shape reads as an empty list, so a corrupt entry cannot break a page. */
function parseIds(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const { version, ids } = (parsed ?? {}) as { version?: unknown; ids?: unknown };
    if (version !== FAVOURITES_STORAGE_VERSION || !Array.isArray(ids)) return [];
    const valid = ids.filter((id): id is string => typeof id === "string" && id !== "");
    return [...new Set(valid)].slice(0, FAVOURITES_MAX);
  } catch {
    return [];
  }
}

function browserStorage(): FavouritesStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * One store's list. When storage is missing or throws (private mode, a full disk) the list lives in memory for the visit,
 * so the hearts still work and nothing fails. Every change reads storage first, so two tabs do not overwrite each other.
 */
export function createFavouritesStore(key: string, getStorage: () => FavouritesStorage | null = browserStorage): FavouritesStore {
  let ids: readonly string[] = NO_FAVOURITES;
  let loaded = false;
  const listeners = new Set<() => void>();

  function read(): void {
    loaded = true;
    try {
      const storage = getStorage();
      if (storage === null) return;
      const next = parseIds(storage.getItem(key));
      if (next.length !== ids.length || next.some((id, index) => id !== ids[index])) ids = next;
    } catch {
      // Keep what is in memory.
    }
  }

  function commit(next: readonly string[]): void {
    ids = next;
    try {
      const storage = getStorage();
      if (next.length === 0) storage?.removeItem(key);
      else storage?.setItem(key, JSON.stringify({ version: FAVOURITES_STORAGE_VERSION, ids: next }));
    } catch {
      // The change stands for this visit.
    }
    for (const listener of listeners) listener();
  }

  function add(productId: string): boolean {
    read();
    if (ids.includes(productId)) return true;
    if (ids.length >= FAVOURITES_MAX) return false;
    commit([...ids, productId]);
    return true;
  }

  function remove(productId: string): void {
    read();
    if (ids.includes(productId)) commit(ids.filter((id) => id !== productId));
  }

  function onStorage(event: StorageEvent): void {
    if (event.key !== key && event.key !== null) return;
    const before = ids;
    read();
    if (ids !== before) for (const listener of listeners) listener();
  }

  return {
    getIds() {
      if (!loaded) read();
      return ids;
    },
    subscribe(listener) {
      if (listeners.size === 0) globalThis.addEventListener?.("storage", onStorage);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) globalThis.removeEventListener?.("storage", onStorage);
      };
    },
    add,
    remove,
    toggle(productId) {
      read();
      if (ids.includes(productId)) {
        remove(productId);
        return false;
      }
      return add(productId);
    },
    prune(productIds) {
      read();
      const gone = new Set(productIds);
      const next = ids.filter((id) => !gone.has(id));
      if (next.length !== ids.length) commit(next);
    },
    clear() {
      read();
      if (ids.length > 0) commit(NO_FAVOURITES);
    },
  };
}

export interface FavouriteProducts {
  /** In the order the shopper saved them. */
  products: StorefrontProductSummary[];
  /** Ids with no Live product behind them. */
  missing: string[];
}

/**
 * The products behind the ids, a page at a time. Any failure rejects, so a caller can never mistake an outage for a list
 * of products that are gone.
 */
export async function loadFavouriteProducts(
  transport: { getProductsByIds: (ids: string[]) => Promise<StorefrontProductSummary[]> },
  ids: readonly string[],
): Promise<FavouriteProducts> {
  const pages: string[][] = [];
  for (let start = 0; start < ids.length; start += FAVOURITES_PAGE_SIZE) pages.push(ids.slice(start, start + FAVOURITES_PAGE_SIZE));
  const results = await Promise.all(pages.map((page) => transport.getProductsByIds(page)));
  const byId = new Map(results.flat().map((product) => [product.id, product]));
  return {
    products: ids.flatMap((id) => {
      const product = byId.get(id);
      return product ? [product] : [];
    }),
    missing: ids.filter((id) => !byId.has(id)),
  };
}

/** The last answer of the Favourites page's lookup: which ids it covered, and what came back. */
export interface FavouritesAnswer<P> {
  ids: readonly string[];
  status: "ok" | "unavailable";
  products: readonly P[];
}

/**
 * What the Favourites page shows (GAP 10). It stays "loading" until the browser's real ids have been read (hydrated)
 * and, when there are ids, a lookup covering every one of them has answered. An empty list after hydration is the only
 * "ok" without a lookup. A heart taken off on the page shrinks ids to a subset of the last answer, so that answer still
 * stands and the card goes at once, with no loading flash; a new id not yet looked up is "loading" again.
 */
export function favouriteProductsView<P extends { id: string }>(
  hydrated: boolean,
  ids: readonly string[],
  answer: FavouritesAnswer<P> | null,
): { status: "loading" | "ok" | "unavailable"; products: P[] } {
  if (!hydrated) return { status: "loading", products: [] };
  if (ids.length === 0) return { status: "ok", products: [] };
  if (answer === null || !ids.every((id) => answer.ids.includes(id))) return { status: "loading", products: [] };
  if (answer.status === "unavailable") return { status: "unavailable", products: [] };
  return { status: "ok", products: answer.products.filter((product) => ids.includes(product.id)) };
}
