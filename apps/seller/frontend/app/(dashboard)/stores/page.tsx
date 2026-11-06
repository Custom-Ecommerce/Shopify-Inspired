/**
 * `/stores` — the workspace portal (Blueprint §6.6): every store the seller
 * owns as a card, or the "No Stores Provisioned Yet" empty state (with a Create Store button)
 * for a brand-new seller. Lives outside any store, so it needs no store context.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight, Store as StoreIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/shared/Surface";
import { EmptyState } from "@/components/dashboard/shared/EmptyState";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { StatusBadge } from "@/components/dashboard/shared/StatusBadge";
import { WorkspaceShell } from "@/components/dashboard/WorkspaceShell";
import { authFailureView } from "@/components/dashboard/WorkspaceNotice";
import { getWorkspace } from "@/lib/dashboard-auth";
import { storeBasePath } from "@/lib/store-routes";
import type { Workspace, WorkspaceStore } from "@/lib/types/dashboard";

export const metadata: Metadata = { title: "Your stores" };

function StoreCard({ store }: { store: WorkspaceStore }) {
  const address = store.domain || store.slug;
  return (
    <Surface
      as={Link}
      href={storeBasePath(store.id)}
      variant="clay"
      level={2}
      radius="2xl"
      lift
      className="flex h-full flex-col gap-4 p-5 no-underline"
    >
      <div className="flex items-start gap-3">
        <Avatar className="size-11 shrink-0 rounded-xl">
          {store.logoUrl ? <AvatarImage src={store.logoUrl} alt="" className="rounded-xl object-cover" /> : null}
          <AvatarFallback className="rounded-xl bg-primary font-heading text-lg text-primary-foreground">
            {store.name.trim().charAt(0).toUpperCase() || "S"}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-heading text-base font-semibold text-foreground">{store.name}</h2>
          <p className="truncate font-mono text-xs text-muted-foreground">{address}</p>
        </div>
        <StatusBadge status={store.status} className="shrink-0" />
      </div>

      {store.status === "suspended" && store.suspensionNote && (
        <p className="line-clamp-2 text-xs text-muted-foreground">{store.suspensionNote}</p>
      )}

      <span className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-primary">
        Open dashboard <ArrowRight className="size-3.5" aria-hidden="true" />
      </span>
    </Surface>
  );
}

export default async function StoresPortalPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("markaz-session")?.value;

  let workspace: Workspace;
  try {
    workspace = await getWorkspace(token);
  } catch (err) {
    return authFailureView(err);
  }

  const { user, stores, limits } = workspace;

  return (
    <WorkspaceShell user={user}>
      <PageHeader
        title="Your stores"
        description={
          stores.length === 0
            ? "Create your first store to get started."
            : `Choose a store to manage. ${limits.used} of ${limits.max} store${limits.max === 1 ? "" : "s"} used.`
        }
      >
        {stores.length > 0 && limits.canCreate && (
          <Button variant="clay" render={<Link href="/stores/new" />}>
            Create Store
          </Button>
        )}
      </PageHeader>

      {stores.length === 0 ? (
        <EmptyState
          title="No Stores Provisioned Yet"
          description="Create your first store to start selling."
          icon={<StoreIcon className="size-7" strokeWidth={1.5} />}
          action={
            <Button variant="clay" render={<Link href="/stores/new" />}>
              Create Store
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {stores.map((store) => (
            <li key={store.id}>
              <StoreCard store={store} />
            </li>
          ))}
        </ul>
      )}
    </WorkspaceShell>
  );
}
