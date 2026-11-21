"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { DataTable, TablePagination, type Column } from "@/components/shared/data-table";
import { FilterTile } from "@/components/shared/filter-tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { listSubscriptionPlans } from "@/lib/api/client";
import type { AdminSubscriptionPlan } from "@/lib/contracts";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useAdminFetch } from "@/lib/hooks/use-admin-fetch";
import { useDebouncedSearch } from "@/lib/hooks/use-debounced-search";
import { PlanArchiveDialog } from "@/components/subscriptions/plan-archive-dialog";
import { PlanDialog } from "@/components/subscriptions/plan-dialog";
import { PLAN_STATUS_LABELS, canArchive, limitsSummary, planStatus, priceLabel } from "@/lib/plans";
import { TIER_LABELS, TIER_VALUES, TIER_VARIANTS, parseSubscriptionState, subscriptionStateToQuery, type SubscriptionListState } from "@/lib/subscriptions";

/** Sprint 6 EP-14: a plan is data. The key and the limits show under the name; an old plan (before Sprint 6) shows its tier and has no limits. */
function columns(onEdit: (plan: AdminSubscriptionPlan) => void, onArchive: (plan: AdminSubscriptionPlan) => void): Array<Column<AdminSubscriptionPlan>> {
  return [
    {
      key: "plan",
      header: "Plan",
      cell: (plan) => (
        <div className="flex min-w-0 flex-col">
          <span className="block max-w-64 truncate font-medium">{plan.name}</span>
          <span className="block max-w-72 truncate text-xs text-muted-foreground">
            {plan.key !== null ? <code className="font-mono">{plan.key}</code> : plan.tier !== null ? "Old tier: " + TIER_LABELS[plan.tier] : "Old plan"}
            {" · "}
            {limitsSummary(plan.limits)}
          </span>
        </div>
      ),
    },
    { key: "price", header: "Price", cell: (plan) => <span className="whitespace-nowrap tabular-nums">{priceLabel(plan.priceRs)}</span> },
    {
      key: "status",
      header: "Status",
      cell: (plan) => {
        const status = planStatus(plan);
        return <Badge variant={status === "active" ? "default" : "neutral"}>{PLAN_STATUS_LABELS[status]}</Badge>;
      },
    },
    {
      key: "tier",
      header: "Old tier",
      className: "hidden lg:table-cell",
      cell: (plan) => (plan.tier === null ? <span className="text-muted-foreground">-</span> : <Badge variant={TIER_VARIANTS[plan.tier]}>{TIER_LABELS[plan.tier]}</Badge>),
    },
    {
      key: "price-id",
      header: "Stripe price",
      className: "hidden xl:table-cell",
      cell: (plan) => <code className="block max-w-56 truncate font-mono text-xs text-muted-foreground">{plan.stripePriceId ?? "-"}</code>,
    },
    {
      key: "added",
      header: "Added",
      className: "hidden lg:table-cell",
      cell: (plan) => (
        <time dateTime={plan.createdAt} title={formatDateTime(plan.createdAt)} className="text-muted-foreground">
          {formatRelative(plan.createdAt)}
        </time>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      cell: (plan) => (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" aria-label={"Edit " + plan.name} onClick={() => onEdit(plan)}>
            Edit
          </Button>
          {canArchive(plan) ? (
            <Button variant="destructive" size="sm" aria-label={"Archive " + plan.name} onClick={() => onArchive(plan)}>
              Archive
            </Button>
          ) : null}
        </div>
      ),
    },
  ];
}

/** The subscription plans at /subscriptions (Sprint 6 EP-14: create, edit and archive). Search, tier, and page live in the URL. */
export function SubscriptionsView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const state = useMemo(() => parseSubscriptionState(searchParams), [searchParams]);

  function go(next: SubscriptionListState) {
    const query = subscriptionStateToQuery(next);
    router.replace(query === "" ? pathname : pathname + "?" + query);
  }

  const [search, setSearch] = useDebouncedSearch(state.q, (q) => go({ ...state, q, page: 1 }));
  const { data, error, loading, refetch } = useAdminFetch((signal) => listSubscriptionPlans(state, signal), [state.page, state.q, state.tier]);

  useEffect(() => {
    if (data && data.totalPages > 0 && state.page > data.totalPages) go({ ...state, page: data.totalPages });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const filtered = state.q !== "" || state.tier !== "";

  // Sprint 6 EP-14: create, edit and archive, each behind its own dialog.
  const [editing, setEditing] = useState<AdminSubscriptionPlan | "new" | null>(null);
  const [archiving, setArchiving] = useState<AdminSubscriptionPlan | null>(null);
  const tableColumns = useMemo(() => columns((plan) => setEditing(plan), (plan) => setArchiving(plan)), []);
  const hasOldTiers = data ? TIER_VALUES.some((tier) => data.counts[tier] > 0) : false;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-heading mb-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Subscriptions</h2>
          <p className="text-sm text-muted-foreground">
            The plans sellers can subscribe to. A plan is data: its price is whole rupees and its limits are enforced. Payment is manual first; Stripe is off.
          </p>
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus aria-hidden />
          New plan
        </Button>
      </div>

      {data && hasOldTiers ? (
        <div className="grid gap-4 sm:grid-cols-3" role="group" aria-label="Filter plans by tier">
          {TIER_VALUES.map((tier) => (
            <FilterTile
              key={tier}
              label={TIER_LABELS[tier]}
              value={data.counts[tier]}
              hint={data.counts[tier] === 1 ? "plan" : "plans"}
              active={state.tier === tier}
              onSelect={() => go({ ...state, tier: state.tier === tier ? "" : tier, page: 1 })}
            />
          ))}
        </div>
      ) : loading ? (
        <div className="grid gap-4 sm:grid-cols-3" aria-busy="true" aria-label="Loading plan counts">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : null}

      <div className="relative" role="search">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          aria-label="Search subscription plans"
          placeholder="Search by plan name"
          className="pl-9"
          value={search}
          maxLength={100}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {error && data ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/20 bg-destructive/8 px-5 py-4 text-sm text-foreground">
          <span>{error.message} The figures shown may be out of date.</span>
          <Button variant="outline" size="sm" onClick={refetch}>
            Try again
          </Button>
        </div>
      ) : null}
      <DataTable
        label="Subscription plans"
        columns={tableColumns}
        rows={data?.docs ?? []}
        rowKey={(plan) => plan.id}
        loading={loading}
        error={error ? error.message : null}
        onRetry={refetch}
        emptyTitle={filtered ? "No plans match" : "No plans yet"}
        emptyHint={filtered ? "Try a different name or clear the tier filter." : "Create the first plan, or run the bootstrap script to seed Free and Growth."}
      />

      {editing !== null ? (
        <PlanDialog
          plan={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            refetch();
          }}
        />
      ) : null}
      {archiving !== null ? (
        <PlanArchiveDialog
          plan={archiving}
          onClose={() => setArchiving(null)}
          onDone={() => {
            setArchiving(null);
            refetch();
          }}
        />
      ) : null}

      {data ? <TablePagination page={data.page} totalPages={data.totalPages} totalDocs={data.totalDocs} noun="plan" disabled={loading} onPage={(page) => go({ ...state, page })} /> : null}
    </div>
  );
}
