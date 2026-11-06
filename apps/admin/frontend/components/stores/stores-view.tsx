"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { DataTable, TablePagination, type Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { listStores } from "@/lib/api/client";
import type { AdminStoreListItem } from "@/lib/contracts";
import { formatPercent, formatRelative } from "@/lib/format";
import { useAdminFetch } from "@/lib/hooks/use-admin-fetch";
import { listStateToQuery, parseListState, type StoreListState } from "@/lib/stores";
import { STORE_STATUS_VALUES, statusLabel } from "@/lib/status";

const SEARCH_DELAY_MS = 300;

const COLUMNS: Array<Column<AdminStoreListItem>> = [
  {
    key: "store",
    header: "Store",
    cell: (store) => (
      <div className="flex min-w-0 flex-col">
        <Link href={"/stores/" + store.id} className="truncate font-medium text-primary underline-offset-4 hover:underline">
          {store.name}
        </Link>
        <span className="truncate text-xs text-muted-foreground">{store.domain ?? store.slug}</span>
      </div>
    ),
  },
  { key: "status", header: "Status", cell: (store) => <StatusBadge status={store.status} /> },
  {
    key: "owner",
    header: "Owner",
    className: "hidden md:table-cell",
    cell: (store) =>
      store.owner ? (
        <div className="flex min-w-0 flex-col">
          <span className="truncate">{store.owner.name}</span>
          <span className="truncate text-xs text-muted-foreground">{store.owner.email}</span>
        </div>
      ) : (
        <span className="text-muted-foreground">No owner</span>
      ),
  },
  {
    key: "commission",
    header: "Commission",
    className: "hidden lg:table-cell",
    cell: (store) => (
      <span>
        {formatPercent(store.commissionRate)} <span className="text-xs text-muted-foreground">{store.commissionMode}</span>
      </span>
    ),
  },
  { key: "created", header: "Created", className: "hidden md:table-cell", cell: (store) => <span className="text-muted-foreground">{formatRelative(store.createdAt)}</span> },
];

/** The store list at /stores. Search, status filter, and page live in the URL, so a view can be shared or reloaded. */
export function StoresView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const state = useMemo(() => parseListState(searchParams), [searchParams]);
  const [search, setSearch] = useState(state.q);
  const latest = useRef(state);
  latest.current = state;

  function go(next: StoreListState) {
    const query = listStateToQuery(next);
    router.replace(query === "" ? pathname : pathname + "?" + query);
  }

  useEffect(() => {
    if (search.trim() === state.q) return;
    const timer = setTimeout(() => go({ ...latest.current, q: search.trim(), page: 1 }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const { data, error, loading, refetch } = useAdminFetch((signal) => listStores(state, signal), [state.page, state.q, state.status]);

  useEffect(() => {
    if (data && data.totalPages > 0 && state.page > data.totalPages) go({ ...state, page: data.totalPages });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const filtered = state.q !== "" || state.status !== "";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h2 className="font-heading mb-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Stores</h2>
        <p className="text-sm text-muted-foreground">Every store on the platform. Open one to review it or change its status.</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row" role="search">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            aria-label="Search stores"
            placeholder="Search by name, slug, domain, or id"
            className="pl-9"
            value={search}
            maxLength={100}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Select
          aria-label="Filter by status"
          className="sm:w-48"
          value={state.status}
          onChange={(event) => go({ ...state, status: event.target.value as StoreListState["status"], page: 1 })}
        >
          <option value="">All statuses</option>
          {STORE_STATUS_VALUES.map((status) => (
            <option key={status} value={status}>
              {statusLabel(status)}
            </option>
          ))}
        </Select>
      </div>

      {error && data ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/20 bg-destructive/8 px-5 py-4 text-sm text-foreground">
          <span>{error.message} The list shown may be out of date.</span>
          <Button variant="outline" size="sm" onClick={refetch}>
            Try again
          </Button>
        </div>
      ) : null}
      <DataTable
        label="Stores"
        columns={COLUMNS}
        rows={data?.docs ?? []}
        rowKey={(store) => store.id}
        loading={loading}
        error={error ? error.message : null}
        onRetry={refetch}
        emptyTitle={filtered ? "No stores match" : "No stores yet"}
        emptyHint={filtered ? "Try a different search or clear the status filter." : "Stores appear here as sellers create them."}
      />

      {data ? (
        <TablePagination page={data.page} totalPages={data.totalPages} totalDocs={data.totalDocs} noun="store" disabled={loading} onPage={(page) => go({ ...state, page })} />
      ) : null}
    </div>
  );
}
