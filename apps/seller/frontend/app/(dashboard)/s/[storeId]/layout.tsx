/**
 * The store dashboard shell: every page under `/s/[storeId]/…` renders inside
 * this layout (Blueprint §6.6, Phase 6B).
 *
 * The ONE place that turns the URL's `storeId` into a verified store:
 * `requireStoreContext(params.storeId)` checks the session and that the store
 * belongs to the seller's workspace. Failures become a redirect or a notice
 * (`authFailureView`), never a half-rendered dashboard. The auth gate for the
 * session itself lives in the parent `(dashboard)/layout.tsx`.
 *
 * Providers are keyed by `storeId`, so switching stores can never show another
 * store's cached data.
 *
 * `Broadcast`'s delivery is currently a no-op (logs intended sends rather than
 * actually sending — no WhatsApp Business API integration exists yet) — see
 * endpoints/broadcast.ts. Every other nav link has a working page.
 */

import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { getStoreFull } from "@/lib/dashboard-auth";
import { resolveStorePage } from "@/lib/resolve-store-page";
import { authFailureView } from "@/components/dashboard/WorkspaceNotice";
import { DashboardProvider } from "@/lib/dashboard-context";
import { DashboardDataProvider } from "@/lib/dashboard-data-context";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { DashboardBreadcrumb } from "@/components/dashboard/shared/DashboardBreadcrumb";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import type { DashboardStore } from "@/lib/types/dashboard";

/**
 * Height of the fixed suspension banner (Tailwind `h-10` = 2.5rem). The sidebar and the sticky
 * top bar are offset by the same amount while the banner is showing, so it never covers them.
 */
const SUSPENSION_BANNER_OFFSET_CLASSES =
  "pt-10 [&_[data-slot=sidebar-container]]:top-10 [&_[data-slot=sidebar-container]]:h-[calc(100svh-2.5rem)]";

export default async function StoreDashboardLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ storeId: string }>;
}) {
  const { storeId } = await params;

  const resolved = await resolveStorePage(storeId);
  if (!resolved.ok) return resolved.view;
  const { token, user, workspace, store: activeStore } = resolved.ctx;

  // Full document (storefront / payment / billing fields) for Store Settings,
  // Billing, Domain and Referrals. A failed detail fetch (non-offline) leaves
  // it `null`; those pages show an error state instead of stale data.
  let store: DashboardStore | null;
  try {
    store = await getStoreFull(token, storeId);
  } catch (err) {
    return authFailureView(err);
  }

  // L4: the seller's account OR this store is suspended → show a persistent, fixed warning.
  // Status comes from the same verified workspace data the rest of the dashboard uses
  // (`activeStore` is membership-checked by `requireStoreContext`), never from the client.
  const isSuspended = user.accountStatus === "suspended" || activeStore.status === "suspended";

  return (
    <DashboardProvider
      value={{
        user,
        storeId: activeStore.id,
        activeStore,
        store,
        stores: workspace.stores,
        limits: workspace.limits,
      }}
    >
      <TooltipProvider>
        {isSuspended && (
          <div
            role="alert"
            aria-live="assertive"
            className="fixed inset-x-0 top-0 z-50 flex h-10 items-center justify-center gap-2 bg-destructive px-4 text-center text-sm font-semibold text-white shadow-md"
          >
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            <span>Your account or store is currently suspended. Write access is disabled.</span>
          </div>
        )}
        <SidebarProvider className={isSuspended ? SUSPENSION_BANNER_OFFSET_CLASSES : undefined}>
          <DashboardSidebar />

          {/* SidebarInset: plain page background (flat Rose style) */}
          {/* min-w-0: without it this flex item cannot shrink below a wide child (the variant table), and pushes the page wider than the screen. */}
          <SidebarInset className="bg-background min-w-0">
            {/* Sticky top bar — blueprint §4.4 */}
            <header className={`sticky ${isSuspended ? "top-10" : "top-0"} z-20 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 backdrop-blur-sm`}>
              <div className="flex flex-1 items-center gap-2 px-4">
                <SidebarTrigger className="-ml-1" />
                <Separator orientation="vertical" className="h-4" />
                <DashboardBreadcrumb />
              </div>

              {/* Right actions */}
              <div className="flex items-center gap-1 px-4">
                <ThemeToggle />
              </div>
            </header>

            {/* Main content: PageContainer applied per-page (blueprint §4.6).
                Pages stop adding their own p-8 once migrated. */}
            <div className="flex min-w-0 flex-1 flex-col">
              <DashboardDataProvider key={activeStore.id}>{children}</DashboardDataProvider>
            </div>
          </SidebarInset>
        </SidebarProvider>
      </TooltipProvider>
    </DashboardProvider>
  );
}
