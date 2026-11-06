"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import type { PanelProps } from "@/components/commission/ledger-panel";
import { DataTable, TablePagination, type Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { listCommissionRates } from "@/lib/api/client";
import { RATE_MODE_LABELS, RATE_MODE_VALUES, type RateModeValue } from "@/lib/commission";
import type { AdminCommissionRateItem } from "@/lib/contracts";
import { formatPercent } from "@/lib/format";
import { useAdminFetch } from "@/lib/hooks/use-admin-fetch";
import { useDebouncedSearch } from "@/lib/hooks/use-debounced-search";

const COLUMNS: Array<Column<AdminCommissionRateItem>> = [
  {
    key: "store",
    header: "Store",
    cell: (store) => (
      <Link href={"/stores/" + store.id} className="block max-w-56 truncate text-primary underline-offset-4 hover:underline">
        {store.name}
      </Link>
    ),
  },
  { key: "status", header: "Status", className: "hidden md:table-cell", cell: (store) => <StatusBadge status={store.status} /> },
  { key: "source", header: "Rate source", cell: (store) => <Badge variant="outline">{RATE_MODE_LABELS[store.commissionMode]}</Badge> },
  {
    key: "own",
    header: "Own rate",
    className: "hidden text-right md:table-cell",
    cell: (store) =>
      store.commissionMode === "inherit" ? <span className="text-muted-foreground">Not used</span> : <span className="tabular-nums">{formatPercent(store.commissionRate)}</span>,
  },
  {
    key: "effective",
    header: "Applies now",
    className: "text-right",
    cell: (store) =>
      store.effectiveRate === null ? <Badge variant="danger">Unresolved</Badge> : <span className="font-medium tabular-nums">{formatPercent(store.effectiveRate)}</span>,
  },
];

/** The platform default rate and the rate that applies to every store. Read only: rates change through the store and settings writes. */
export function RatesPanel({ state, go }: PanelProps) {
  const [search, setSearch] = useDebouncedSearch(state.q, (q) => go({ ...state, q, page: 1 }));
  const { data, error, loading, refetch } = useAdminFetch((signal) => listCommissionRates(state, signal), [state.page, state.q, state.mode]);

  useEffect(() => {
    if (data && data.totalPages > 0 && state.page > data.totalPages) go({ ...state, page: data.totalPages });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const filtered = state.q !== "" || state.mode !== "";

  return (
    <>
      {data ? (
        <Card>
          <CardHeader>
            <CardTitle>Platform default rate</CardTitle>
            <CardDescription>Applies to every store whose rate source is the platform default.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums tracking-tight text-foreground">{data.defaultRate === null ? "Not set" : formatPercent(data.defaultRate)}</p>
          </CardContent>
        </Card>
      ) : loading ? (
        <div aria-busy="true" aria-label="Loading the default rate">
          <Skeleton className="h-32" />
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row" role="search">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            aria-label="Search stores"
            placeholder="Search by store name, slug, domain, or id"
            className="pl-9"
            value={search}
            maxLength={100}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Select
          aria-label="Filter by rate source"
          className="sm:w-56"
          value={state.mode}
          onChange={(event) => go({ ...state, mode: event.target.value as RateModeValue | "", page: 1 })}
        >
          <option value="">All rate sources</option>
          {RATE_MODE_VALUES.map((mode) => (
            <option key={mode} value={mode}>
              {RATE_MODE_LABELS[mode]}
            </option>
          ))}
        </Select>
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
        label="Store commission rates"
        columns={COLUMNS}
        rows={data?.docs ?? []}
        rowKey={(store) => store.id}
        loading={loading}
        error={error ? error.message : null}
        onRetry={refetch}
        emptyTitle={filtered ? "No stores match" : "No stores yet"}
        emptyHint={filtered ? "Try a different name or clear the rate source filter." : "Stores appear here as sellers create them."}
      />

      {data ? <TablePagination page={data.page} totalPages={data.totalPages} totalDocs={data.totalDocs} noun="store" disabled={loading} onPage={(page) => go({ ...state, page })} /> : null}
    </>
  );
}
