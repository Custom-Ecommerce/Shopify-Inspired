"use client";

import Link from "next/link";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import { FieldList } from "@/components/shared/field-list";
import { StatusBadge } from "@/components/shared/status-badge";
import { GovernancePanel } from "@/components/stores/governance-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getStore } from "@/lib/api/client";
import type { AdminStoreAuditEntry, AdminStoreDetail } from "@/lib/contracts";
import { formatDateTime, formatPercent, formatRelative, shortId } from "@/lib/format";
import { useAdminFetch } from "@/lib/hooks/use-admin-fetch";
import { statusLabel } from "@/lib/status";

const ACTION_LABELS: Record<string, string> = {
  "store.suspend": "Suspended",
  "store.activate": "Activated",
  "store.change_rolled_back": "Change not recorded",
};

function BackLink() {
  return (
    <Link href="/stores" className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
      <ArrowLeft className="size-4" aria-hidden />
      Stores
    </Link>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading store">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-64 lg:col-span-2" />
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}

function HistoryItem({ entry }: { entry: AdminStoreAuditEntry }) {
  return (
    <li className="flex flex-col gap-1 border-b border-border py-4 last:border-0 last:pb-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {ACTION_LABELS[entry.action] ?? entry.action}
          {entry.from && entry.to ? <span className="font-normal text-muted-foreground"> ({statusLabel(entry.from)} to {statusLabel(entry.to)})</span> : null}
        </span>
        <time dateTime={entry.createdAt} title={formatDateTime(entry.createdAt)} className="text-xs text-muted-foreground">
          {formatRelative(entry.createdAt)}
        </time>
      </div>
      {entry.reason ? <p className="text-sm">{entry.reason}</p> : null}
      {entry.note ? <p className="text-sm text-muted-foreground">Note: {entry.note}</p> : null}
      <p className="text-xs text-muted-foreground">By {entry.actor.name ?? "an operator (" + shortId(entry.actor.id) + ")"}</p>
    </li>
  );
}

function Detail({ store, onChanged }: { store: AdminStoreDetail; onChanged: () => void }) {
  const suspended = store.status === "suspended" || store.suspensionReason !== null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <BackLink />
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{store.name}</h2>
          <StatusBadge status={store.status} />
          {store.isThemeDemo ? <span className="text-xs text-muted-foreground">Theme demo</span> : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {store.slug} - id {shortId(store.id)}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Store</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldList
                items={[
                  { label: "Name", value: store.name },
                  { label: "Slug", value: store.slug },
                  { label: "Handle", value: store.internalHandle ?? "-" },
                  { label: "Domain", value: store.domain ?? "-" },
                  { label: "Domain status", value: statusLabel(store.customDomainStatus) },
                  { label: "Theme", value: store.activeTheme ?? "-" },
                  { label: "Created", value: formatDateTime(store.createdAt) },
                  { label: "Status changed", value: formatDateTime(store.statusChangedAt) },
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Commission and billing</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldList
                items={[
                  { label: "Commission rate", value: formatPercent(store.commissionRate) },
                  { label: "Commission mode", value: statusLabel(store.commissionMode) },
                  { label: "Stripe onboarding", value: store.stripeOnboardingStatus ? statusLabel(store.stripeOnboardingStatus) : "-" },
                  { label: "Card payments", value: store.stripeChargesEnabled === null ? "-" : store.stripeChargesEnabled ? "Enabled" : "Not enabled" },
                ]}
              />
            </CardContent>
          </Card>

          {suspended && store.suspensionReason ? (
            <Card>
              <CardHeader>
                <CardTitle>Suspension</CardTitle>
              </CardHeader>
              <CardContent>
                <FieldList
                  items={[
                    { label: "Reason", value: store.suspensionReason },
                    { label: "Suspended", value: formatDateTime(store.suspendedAt) },
                    { label: "Internal note", value: store.suspensionNote ?? "-" },
                  ]}
                />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Governance history</CardTitle>
              <CardDescription>The most recent status changes, newest first.</CardDescription>
            </CardHeader>
            <CardContent>
              {store.history.length === 0 ? (
                <p className="text-sm text-muted-foreground">No status changes have been made from the console.</p>
              ) : (
                <ul aria-label="Governance history">
                  {store.history.map((entry) => (
                    <HistoryItem key={entry.id} entry={entry} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <GovernancePanel key={store.id + store.status} store={store} onChanged={onChanged} />
          <Card>
            <CardHeader>
              <CardTitle>Owner</CardTitle>
            </CardHeader>
            <CardContent>
              {store.owner ? (
                <div className="flex flex-col text-sm">
                  <span className="font-medium">{store.owner.name}</span>
                  <span className="break-all text-muted-foreground">{store.owner.email}</span>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">This store has no owner.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function StoreDetailView({ id }: { id: string }) {
  const { data, error, loading, refetch } = useAdminFetch((signal) => getStore(id, signal), [id]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      {data ? (
        <Detail store={data} onChanged={refetch} />
      ) : error ? (
        <div className="flex flex-col gap-4">
          <BackLink />
          <Card role="alert" className="flex flex-col items-center gap-4 border-destructive/20 bg-destructive/8 px-6 py-12 text-center">
            <span className="flex size-12 items-center justify-center rounded-xl border border-destructive/20 bg-destructive/10">
              <TriangleAlert className="size-6 text-destructive" aria-hidden />
            </span>
            <p className="max-w-sm text-sm font-medium text-foreground">{error.status === 404 ? "This store does not exist." : error.message}</p>
            {error.status === 404 ? null : (
              <Button variant="outline" size="sm" onClick={refetch}>
                Try again
              </Button>
            )}
          </Card>
        </div>
      ) : (
        loading && <DetailSkeleton />
      )}
    </div>
  );
}
