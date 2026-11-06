import type { Store as PayloadStoreDoc } from "@markaz/contracts";
import type { User as PayloadUserDoc } from "@markaz/contracts";

/**
 * Named dashboard-domain types. Aliases of the generated Payload types so the
 * schema is not forked.
 *
 * `DashboardUser` carries the multi-store fields returned by the Seller
 * backend's `GET /api/users/me` (§6.2): `stores` (owned store ids, possibly
 * populated) and `accountStatus`. Phase 6B removes the legacy singular `store`
 * field from the type, so any remaining `user.store` read fails to compile —
 * the active store comes from the `/s/[storeId]` route segment only.
 */
export type DashboardUser = Omit<PayloadUserDoc, "store"> & {
  stores?: (string | { id: string })[] | null;
  accountStatus?: "active" | "suspended" | null;
};
export type DashboardStore = PayloadStoreDoc;

// ── Workspace contract: `GET /api/workspace` (Blueprint §6.2) ────────────────

export type WorkspaceStoreStatus = "pending" | "active" | "suspended" | "archived";

export type CustomDomainStatus = "unset" | "pending" | "verified" | "failed";

/** One owned store, summarised for the switcher / picker / suspension banner. */
export interface WorkspaceStore {
  id: string;
  name: string;
  slug: string;
  internalHandle?: string | null;
  status: WorkspaceStoreStatus;
  suspensionReason?: string | null;
  suspensionNote?: string | null;
  suspendedAt?: string | null;
  logoUrl?: string | null;
  activeTheme?: string | null;
  domain?: string | null;
  customDomainStatus?: CustomDomainStatus | null;
  billing?: {
    stripeOnboardingStatus?: string | null;
    stripeChargesEnabled?: boolean | null;
  } | null;
}

export interface WorkspaceUser {
  id: string;
  name?: string | null;
  email: string;
  accountStatus?: "active" | "suspended" | null;
}

export interface WorkspaceLimits {
  used: number;
  max: number;
  canCreate: boolean;
}

export interface Workspace {
  user: WorkspaceUser;
  stores: WorkspaceStore[];
  limits: WorkspaceLimits;
}

/** Result of `requireStoreContext` — the single server-side resolver. */
export interface StoreContext {
  token: string;
  user: DashboardUser;
  workspace: Workspace;
  store: WorkspaceStore;
}
