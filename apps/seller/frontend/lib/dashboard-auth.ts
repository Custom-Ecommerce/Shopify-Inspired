import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";

import { DashboardAuthError, isDashboardAuthError } from "@/lib/error-codes";
import type {
  DashboardStore,
  DashboardUser,
  StoreContext,
  Workspace,
} from "@/lib/types/dashboard";

const PAYLOAD_API_URL = (process.env.SELLER_BACKEND_API_URL || "http://localhost:4001").replace(/\/$/, "");

/** Statuses that mean "the gateway/backend is down", as opposed to a real answer. */
const OFFLINE_STATUSES = new Set([502, 503, 504]);

/**
 * Transitional flag (Blueprint §6.4 step 5). When on, a seller who owns exactly
 * ONE store is resolved implicitly: by the proxy for requests without
 * `x-store-id`, and by the `/` resolver page, which then forwards straight to
 * `/s/<id>`. Dashboard pages themselves never use it — they always read the
 * `[storeId]` route segment. Turned off in Phase 6.6.
 */
export function isImplicitDefaultEnabled(): boolean {
  return process.env.MULTISTORE_IMPLICIT_DEFAULT === "true";
}

/** Normalises `user.stores` (ids or populated docs) to a plain list of ids. */
export function extractStoreIds(user: Pick<DashboardUser, "stores"> | null | undefined): string[] {
  const raw = user?.stores;
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const entry of raw) {
    const id = typeof entry === "object" && entry !== null ? entry.id : entry;
    if (id !== undefined && id !== null && String(id) !== "") ids.push(String(id));
  }
  return ids;
}

/**
 * Resolves the logged-in seller from the `markaz-session` cookie value via
 * `GET /api/users/me`. Memoised per server render with React `cache`.
 *
 * - no token / 401 / 403 / unusable body → `null` (caller decides: redirect, 401…)
 * - network failure or 502/503/504       → throws `DashboardAuthError("BACKEND_OFFLINE")`
 */
export const getDashboardUser = cache(async (token: string | undefined): Promise<DashboardUser | null> => {
  if (!token) return null;
  let res: Response;
  try {
    res = await fetch(`${PAYLOAD_API_URL}/api/users/me`, {
      headers: { Authorization: `JWT ${token}` },
      cache: "no-store",
    });
  } catch (err) {
    console.error("[dashboard-auth] Failed to reach seller-backend while fetching /api/users/me:", err);
    throw new DashboardAuthError("BACKEND_OFFLINE", { cause: err });
  }
  if (OFFLINE_STATUSES.has(res.status)) throw new DashboardAuthError("BACKEND_OFFLINE");
  if (!res.ok) return null;
  try {
    const { user }: { user: DashboardUser | null } = await res.json();
    return user ?? null;
  } catch {
    return null;
  }
});

/**
 * `GET /api/workspace` (Blueprint §6.2): the user, a summary of every owned
 * store, and limits — in one call. Memoised per server render (React `cache`),
 * so the layout and the pages beneath it share a single upstream request.
 * Always `no-store`: suspension state must be fresh on every navigation.
 *
 * Throws `DashboardAuthError`: `UNAUTHENTICATED` (401), `ACCOUNT_SUSPENDED`
 * (403 + that code), `BACKEND_OFFLINE` (network / 502-504 / 5xx).
 */
export const getWorkspace = cache(async (token: string | undefined): Promise<Workspace> => {
  if (!token) throw new DashboardAuthError("UNAUTHENTICATED");

  let res: Response;
  try {
    res = await fetch(`${PAYLOAD_API_URL}/api/workspace`, {
      headers: { Authorization: `JWT ${token}` },
      cache: "no-store",
    });
  } catch (err) {
    console.error("[dashboard-auth] Failed to reach seller-backend while fetching /api/workspace:", err);
    throw new DashboardAuthError("BACKEND_OFFLINE", { cause: err });
  }

  if (res.status === 401) throw new DashboardAuthError("UNAUTHENTICATED");
  if (res.status === 403) {
    const body: { code?: string } | null = await res.json().catch(() => null);
    throw new DashboardAuthError(body?.code === "ACCOUNT_SUSPENDED" ? "ACCOUNT_SUSPENDED" : "UNAUTHENTICATED");
  }
  if (!res.ok) {
    console.error(`[dashboard-auth] /api/workspace responded ${res.status}`);
    throw new DashboardAuthError("BACKEND_OFFLINE");
  }

  const data: Workspace | null = await res.json().catch(() => null);
  if (!data || !Array.isArray(data.stores)) {
    console.error("[dashboard-auth] /api/workspace returned an unexpected payload");
    throw new DashboardAuthError("BACKEND_OFFLINE");
  }
  return data;
});

/**
 * The single server-side resolver for "which store is this request about".
 *
 * cookie → user → workspace → check `storeIdFromPath ∈ workspace.stores`.
 * Never reads `user.store`, never falls back to an owner query.
 *
 * Throws `DashboardAuthError`:
 *  - `UNAUTHENTICATED`  no cookie / invalid token
 *  - `BACKEND_OFFLINE`  seller backend unreachable
 *  - `NO_STORES`        authenticated seller owns no store at all
 *  - `STORE_FORBIDDEN`  store is not in the seller's workspace (existence is not revealed)
 */
export async function requireStoreContext(storeIdFromPath: string): Promise<StoreContext> {
  const cookieStore = await cookies();
  const token = cookieStore.get("markaz-session")?.value;
  if (!token) throw new DashboardAuthError("UNAUTHENTICATED");

  const user = await getDashboardUser(token);
  if (!user) throw new DashboardAuthError("UNAUTHENTICATED");

  const workspace = await getWorkspace(token);
  if (workspace.stores.length === 0) throw new DashboardAuthError("NO_STORES");

  const store = workspace.stores.find((s) => String(s.id) === String(storeIdFromPath));
  if (!store) throw new DashboardAuthError("STORE_FORBIDDEN");

  return { token, user, workspace, store };
}

/**
 * Full store document (incl. owner-only fields) for Store Settings / Billing.
 * The active store is passed explicitly via `x-store-id`; the backend
 * re-validates it against the token's user.
 */
export async function getStoreFull(token: string, storeId: string): Promise<DashboardStore | null> {
  try {
    const res = await fetch(`${PAYLOAD_API_URL}/api/stores/${encodeURIComponent(storeId)}?depth=1`, {
      headers: { Authorization: `JWT ${token}`, "x-store-id": storeId },
      cache: "no-store",
    });
    if (OFFLINE_STATUSES.has(res.status)) throw new DashboardAuthError("BACKEND_OFFLINE");
    if (!res.ok) return null;
    return (await res.json()) as DashboardStore;
  } catch (err) {
    if (isDashboardAuthError(err)) throw err;
    console.error("[dashboard-auth] Failed to fetch store document:", err);
    throw new DashboardAuthError("BACKEND_OFFLINE", { cause: err });
  }
}

/**
 * Convenience for server components: the cookie's token and the resolved user.
 * Does not redirect — layouts own that decision.
 */
export async function getDashboardSession(): Promise<{ token: string | undefined; user: DashboardUser | null }> {
  const cookieStore = await cookies();
  const token = cookieStore.get("markaz-session")?.value;
  const user = await getDashboardUser(token);
  return { token, user };
}
