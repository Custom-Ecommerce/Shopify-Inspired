"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { DataTable, TablePagination, type Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSellerPlans, listSellers } from "@/lib/api/client";
import type { AdminSellerListItem } from "@/lib/contracts";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useAdminFetch } from "@/lib/hooks/use-admin-fetch";
import { useDebouncedSearch } from "@/lib/hooks/use-debounced-search";
import { parseSellerListState, sellerStateToQuery, type SellerListState } from "@/lib/sellers";
import { SellerStatusDialog } from "@/components/sellers/seller-status-dialog";
import { StoreLimitDialog } from "@/components/sellers/store-limit-dialog";
import { Badge } from "@/components/ui/badge";
import { PLAN_STATUS_TONE, apiKeysText, atLimit, plansBySeller, planSummaryLine, sellerIdsOf, usageText } from "@/lib/seller-plans";
import type { AdminSellerPlan } from "@/lib/contracts";

const COLUMNS: Array<Column<AdminSellerListItem>> = [
  {
    key: "seller",
    header: "Seller",
    cell: (seller) => (
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{seller.name}</span>
        <span className="truncate text-xs text-muted-foreground">{seller.email}</span>
      </div>
    ),
  },
  {
    key: "stores",
    header: "Stores",
    cell: (seller) =>
      seller.storeCount === 0 ? (
        <span className="text-muted-foreground">No stores</span>
      ) : (
        <ul className="flex min-w-0 flex-col gap-1" aria-label={"Stores of " + seller.name}>
          {seller.stores.map((store) => (
            <li key={store.id} className="flex min-w-0 flex-wrap items-center gap-2">
              <Link href={"/stores/" + store.id} className="truncate text-primary underline-offset-4 hover:underline">
                {store.name}
              </Link>
              <StatusBadge status={store.status} />
              {store.members && store.members.active + store.members.invited > 0 ? (
                <span className="shrink-0 text-xs text-muted-foreground" title={store.members.active + " active, " + store.members.invited + " invited"}>
                  {store.members.active} {store.members.active === 1 ? "member" : "members"}
                  {store.members.invited > 0 ? ", " + store.members.invited + " invited" : ""}
                </span>
              ) : null}
            </li>
          ))}
          {seller.storeCount > seller.stores.length ? <li className="text-xs text-muted-foreground">+{seller.storeCount - seller.stores.length} more</li> : null}
        </ul>
      ),
  },
  {
    key: "joined",
    header: "Joined",
    className: "hidden md:table-cell",
    cell: (seller) => (
      <time dateTime={seller.createdAt} title={formatDateTime(seller.createdAt)} className="text-muted-foreground">
        {formatRelative(seller.createdAt)}
      </time>
    ),
  },
  {
    key: "account",
    header: "Account",
    cell: (seller) => <StatusBadge status={seller.accountStatus} />,
  },
];

/** The seller list at /sellers. Search and page live in the URL, so a view can be shared or reloaded. */
export function SellersView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const state = useMemo(() => parseSellerListState(searchParams), [searchParams]);

  function go(next: SellerListState) {
    const query = sellerStateToQuery(next);
    router.replace(query === "" ? pathname : pathname + "?" + query);
  }

  const [search, setSearch] = useDebouncedSearch(state.q, (q) => go({ ...state, q, page: 1 }));
  const { data, error, loading, refetch } = useAdminFetch((signal) => listSellers(state, signal), [state.page, state.q]);

  useEffect(() => {
    if (data && data.totalPages > 0 && state.page > data.totalPages) go({ ...state, page: data.totalPages });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const filtered = state.q !== "";

  // Sprint 6 EP-14.US02.T08: the plan, status and usage of the sellers on this page, through a signed call to the seller backend. A separate
  // fetch: if it fails the list still shows, and the Plan column shows a dash.
  const ids = data ? sellerIdsOf(data.docs) : [];
  const plansFetch = useAdminFetch(async (signal) => (ids.length === 0 ? null : getSellerPlans(ids, signal)), [ids.join(",")]);
  const plans = useMemo(() => plansBySeller(plansFetch.data?.plans ?? []), [plansFetch.data]);

  // Sprint 4 EP-08.US03.T02: suspend or unsuspend, behind a confirm dialog.
  const [changing, setChanging] = useState<AdminSellerListItem | null>(null);
  // Sprint 6 EP-12.US02.T03: the Store limit dialog.
  const [limiting, setLimiting] = useState<AdminSellerListItem | null>(null);
  const columns = useMemo<Array<Column<AdminSellerListItem>>>(
    () => [
      ...COLUMNS,
      {
        key: "plan",
        header: "Plan",
        cell: (seller) => <PlanCell plan={plans.get(seller.id) ?? null} unavailable={plansFetch.error !== null} />,
      },
      {
        key: "actions",
        header: "Actions",
        cell: (seller) => (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" aria-label={"Store limit of " + seller.name} onClick={() => setLimiting(seller)}>
              Store limit
            </Button>
            {seller.accountStatus === "blocked" ? (
              <span className="self-center text-xs text-muted-foreground">Blocked</span>
            ) : (
              <Button variant={seller.accountStatus === "suspended" ? "outline" : "destructive"} size="sm" onClick={() => setChanging(seller)}>
                {seller.accountStatus === "suspended" ? "Unsuspend" : "Suspend"}
              </Button>
            )}
          </div>
        ),
      },
    ],
    [plans, plansFetch.error],
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h2 className="font-heading mb-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Sellers</h2>
        <p className="text-sm text-muted-foreground">Every seller account on the platform, with the stores they own.</p>
      </div>

      <div className="relative" role="search">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          aria-label="Search sellers"
          placeholder="Search by name, email, or id"
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
        label="Sellers"
        stackOnPhone
        columns={columns}
        rows={data?.docs ?? []}
        rowKey={(seller) => seller.id}
        loading={loading}
        error={error ? error.message : null}
        onRetry={refetch}
        emptyTitle={filtered ? "No sellers match" : "No sellers yet"}
        emptyHint={filtered ? "Try a different name, email, or id." : "Sellers appear here as they sign up."}
      />

      {changing ? (
        <SellerStatusDialog
          seller={changing}
          onClose={() => setChanging(null)}
          onDone={() => {
            setChanging(null);
            refetch();
          }}
        />
      ) : null}

      {limiting ? (
        <StoreLimitDialog
          seller={limiting}
          onClose={() => setLimiting(null)}
          onDone={() => {
            setLimiting(null);
            refetch();
          }}
        />
      ) : null}

      {data ? <TablePagination page={data.page} totalPages={data.totalPages} totalDocs={data.totalDocs} noun="seller" disabled={loading} onPage={(page) => go({ ...state, page })} /> : null}
    </div>
  );
}

/** Sprint 6 EP-14.US02.T08: the plan name and status, the usage against the stores and products limits, and the API key count (S8-B5). A dash while it loads or if it failed. */
function PlanCell({ plan, unavailable }: { plan: AdminSellerPlan | null; unavailable: boolean }) {
  if (plan === null) return <span className="text-muted-foreground" title={unavailable ? "The plan could not be loaded" : undefined}>-</span>;
  return (
    <div className="flex min-w-0 flex-col gap-1" data-slot="seller-plan">
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{plan.plan.name}</span>
        <Badge variant={PLAN_STATUS_TONE[plan.status]}>{planSummaryLine(plan)}</Badge>
      </span>
      <span className={"text-xs " + (atLimit(plan.used.stores, plan.limits.stores) ? "font-medium text-foreground" : "text-muted-foreground")}>
        Stores {usageText(plan.used.stores, plan.limits.stores)}
      </span>
      <span className={"text-xs " + (atLimit(plan.used.products, plan.limits.products) ? "font-medium text-foreground" : "text-muted-foreground")}>
        Products {usageText(plan.used.products, plan.limits.products)}
      </span>
      <span className="text-xs text-muted-foreground">{apiKeysText(plan)}</span>
    </div>
  );
}
