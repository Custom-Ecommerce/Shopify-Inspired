"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
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
import { TIER_LABELS, TIER_VALUES, TIER_VARIANTS, parseSubscriptionState, subscriptionStateToQuery, type SubscriptionListState } from "@/lib/subscriptions";

const COLUMNS: Array<Column<AdminSubscriptionPlan>> = [
  { key: "plan", header: "Plan", cell: (plan) => <span className="block max-w-64 truncate font-medium">{plan.name}</span> },
  { key: "tier", header: "Tier", cell: (plan) => <Badge variant={TIER_VARIANTS[plan.tier]}>{TIER_LABELS[plan.tier]}</Badge> },
  {
    key: "price",
    header: "Stripe price",
    className: "hidden md:table-cell",
    cell: (plan) => <code className="block max-w-56 truncate font-mono text-xs text-muted-foreground">{plan.stripePriceId}</code>,
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
];

/** The subscription plans at /subscriptions. Search, tier, and page live in the URL. Plans are read only until AF3. */
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

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h2 className="font-heading mb-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Subscriptions</h2>
        <p className="text-sm text-muted-foreground">The plans sellers can subscribe to, each tied to a Stripe price. Plans are read only here; editing arrives in a later phase.</p>
      </div>

      {data ? (
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
        columns={COLUMNS}
        rows={data?.docs ?? []}
        rowKey={(plan) => plan.id}
        loading={loading}
        error={error ? error.message : null}
        onRetry={refetch}
        emptyTitle={filtered ? "No plans match" : "No plans yet"}
        emptyHint={filtered ? "Try a different name or clear the tier filter." : "Plans appear here once they are created in the admin database."}
      />

      {data ? <TablePagination page={data.page} totalPages={data.totalPages} totalDocs={data.totalDocs} noun="plan" disabled={loading} onPage={(page) => go({ ...state, page })} /> : null}
    </div>
  );
}
