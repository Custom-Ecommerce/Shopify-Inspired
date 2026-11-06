"use client";

import { createContext, useCallback, useContext } from "react";
import type {
  DashboardStore,
  DashboardUser,
  WorkspaceLimits,
  WorkspaceStore,
} from "@/lib/types/dashboard";
import { storeHref } from "@/lib/store-routes";

/**
 * Phase 6B — everything the `/s/[storeId]` subtree needs, resolved ONCE
 * server-side in `app/(dashboard)/s/[storeId]/layout.tsx` via
 * `requireStoreContext(params.storeId)`.
 *
 * `storeId` is always the URL segment — it is never derived from `user`.
 * Pages and client components must read the active store from here (or from
 * their own route params), never from `user.store`.
 */
export interface DashboardContextValue {
  user: DashboardUser;
  /** The active store id: the `[storeId]` URL segment, already membership-checked. */
  storeId: string;
  /** Workspace summary of the active store (name, slug, status, …). Always present. */
  activeStore: WorkspaceStore;
  /**
   * Full store document (owner-only fields: storefront, paymentSettings, billing…).
   * `null` only when the detail fetch failed; pages that need it show an error state.
   */
  store: DashboardStore | null;
  /** Every store the seller owns — feeds the store switcher. */
  stores: WorkspaceStore[];
  limits: WorkspaceLimits;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function DashboardProvider({
  value,
  children,
}: {
  value: DashboardContextValue;
  children: React.ReactNode;
}) {
  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboard(): DashboardContextValue {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error("useDashboard must be used within a DashboardProvider");
  return ctx;
}

/** The active store id (the `[storeId]` URL segment). */
export function useActiveStoreId(): string {
  return useDashboard().storeId;
}

/**
 * Store-aware `href()` helper (Blueprint §6.6): `href("/orders")` →
 * `/s/<activeStoreId>/orders`. Use for every `<Link>` and `router.push`
 * inside the dashboard.
 */
export function useStoreHref(): (path?: string) => string {
  const storeId = useActiveStoreId();
  return useCallback((path: string = "/") => storeHref(storeId, path), [storeId]);
}
