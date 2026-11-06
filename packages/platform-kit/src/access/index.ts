/**
 * Access primitives (blueprint §4.6 `access`, §5.1).
 *
 * Phase 1: minimal, pure stubs operating on a minimal user shape — no
 * Payload imports. The full scoping rules and the status-gate policy table
 * land in Phase 4 together with their unit tests.
 */

export type StoreId = string | number;

/** A relationship value as Payload returns it: raw id or populated doc. */
export type StoreRef = StoreId | { id: StoreId } | null | undefined;

/** The minimal user shape the access rules need. */
export interface AccessUser {
  id?: StoreId;
  /** Seller DB cache of owned store ids (`Users.stores`). */
  stores?: StoreRef[] | null;
  /** Deprecated single "primary store" (`Users.store`). */
  store?: StoreRef;
}

export function refToId(ref: StoreRef): string | null {
  if (ref == null) return null;
  const id = typeof ref === "object" ? ref.id : ref;
  return id == null ? null : String(id);
}

/**
 * Ids of every store the user owns, as strings, de-duplicated.
 * Falls back to the deprecated `store` field when `stores` is empty so a
 * single-store seller keeps working during the transition.
 */
export function getOwnedStoreIds(user: AccessUser | null | undefined): string[] {
  if (!user) return [];
  const ids = (user.stores ?? [])
    .map(refToId)
    .filter((id): id is string => id !== null);
  if (ids.length === 0) {
    const legacy = refToId(user.store);
    if (legacy) ids.push(legacy);
  }
  return Array.from(new Set(ids));
}

export type ActiveStoreResolution =
  | { ok: true; storeId: string | null; narrowed: boolean }
  | { ok: false; reason: "STORE_FORBIDDEN" };

/**
 * Two-tier active-store resolution (blueprint §3.3):
 *  - no header   -> widen to the owned set (`storeId: null`, `narrowed: false`)
 *  - valid header (store ∈ owned) -> narrow to exactly that store
 *  - invalid header -> deny; never fall back to another store
 */
export function activeStore(
  user: AccessUser | null | undefined,
  requestedStoreId: string | number | null | undefined,
): ActiveStoreResolution {
  const owned = getOwnedStoreIds(user);
  if (requestedStoreId === null || requestedStoreId === undefined || requestedStoreId === "") {
    return { ok: true, storeId: null, narrowed: false };
  }
  const requested = String(requestedStoreId);
  if (!owned.includes(requested)) {
    return { ok: false, reason: "STORE_FORBIDDEN" };
  }
  return { ok: true, storeId: requested, narrowed: true };
}
