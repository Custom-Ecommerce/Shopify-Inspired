"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { DataTable, TablePagination, type Column } from "@/components/shared/data-table";
import { FilterTile } from "@/components/shared/filter-tile";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { listCommissionLedger } from "@/lib/api/client";
import {
  LEDGER_STATUS_LABELS,
  LEDGER_STATUS_VALUES,
  PAYMENT_METHOD_LABELS,
  entryCountLabel,
  type CommissionListState,
} from "@/lib/commission";
import type { AdminLedgerEntry } from "@/lib/contracts";
import { formatDateTime, formatMoney, formatPercent, formatRelative } from "@/lib/format";
import { useAdminFetch } from "@/lib/hooks/use-admin-fetch";
import { useDebouncedSearch } from "@/lib/hooks/use-debounced-search";

const COLUMNS: Array<Column<AdminLedgerEntry>> = [
  {
    key: "store",
    header: "Store",
    cell: (entry) =>
      entry.store ? (
        <Link href={"/stores/" + entry.store.id} className="block max-w-56 truncate text-primary underline-offset-4 hover:underline">
          {entry.store.name}
        </Link>
      ) : (
        <span className="text-muted-foreground">No store</span>
      ),
  },
  { key: "order", header: "Order amount", className: "hidden text-right md:table-cell", cell: (entry) => <span className="tabular-nums">{formatMoney(entry.orderAmount)}</span> },
  { key: "rate", header: "Rate", className: "hidden text-right lg:table-cell", cell: (entry) => <span className="tabular-nums">{formatPercent(entry.commissionRate)}</span> },
  {
    key: "commission",
    header: "Commission",
    className: "text-right",
    cell: (entry) => (
      <div className="flex flex-col items-end gap-1">
        <span className="font-medium tabular-nums">{formatMoney(entry.commissionAmount)}</span>
        {entry.commissionAmount < 0 ? <Badge variant="outline">Refund</Badge> : null}
      </div>
    ),
  },
  { key: "status", header: "Status", cell: (entry) => <StatusBadge status={entry.status} label={LEDGER_STATUS_LABELS[entry.status]} /> },
  {
    key: "method",
    header: "Payment",
    className: "hidden md:table-cell",
    cell: (entry) => <span>{entry.paymentMethod ? (PAYMENT_METHOD_LABELS[entry.paymentMethod] ?? entry.paymentMethod) : "-"}</span>,
  },
  {
    key: "settlement",
    header: "Settlement",
    className: "hidden lg:table-cell",
    cell: (entry) =>
      entry.settlementDate || entry.settlementRef ? (
        <div className="flex min-w-0 flex-col">
          {entry.settlementDate ? (
            <time dateTime={entry.settlementDate} title={formatDateTime(entry.settlementDate)}>
              {formatRelative(entry.settlementDate)}
            </time>
          ) : null}
          {entry.settlementRef ? <span className="truncate text-xs text-muted-foreground">{entry.settlementRef}</span> : null}
        </div>
      ) : (
        <span className="text-muted-foreground">-</span>
      ),
  },
  {
    key: "recorded",
    header: "Recorded",
    className: "hidden md:table-cell",
    cell: (entry) => (
      <time dateTime={entry.createdAt} title={formatDateTime(entry.createdAt)} className="whitespace-nowrap text-muted-foreground">
        {formatRelative(entry.createdAt)}
      </time>
    ),
  },
];

export interface PanelProps {
  state: CommissionListState;
  go: (next: CommissionListState) => void;
}

/** The commission ledger: totals by status as filters, a store or reference search, and a page of rows. Read only. */
export function LedgerPanel({ state, go }: PanelProps) {
  const [search, setSearch] = useDebouncedSearch(state.q, (q) => go({ ...state, q, page: 1 }));
  const { data, error, loading, refetch } = useAdminFetch((signal) => listCommissionLedger(state, signal), [state.page, state.q, state.status]);

  useEffect(() => {
    if (data && data.totalPages > 0 && state.page > data.totalPages) go({ ...state, page: data.totalPages });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const filtered = state.q !== "" || state.status !== "";

  return (
    <>
      {data ? (
        <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Filter the ledger by status">
          {LEDGER_STATUS_VALUES.map((status) => (
            <FilterTile
              key={status}
              label={LEDGER_STATUS_LABELS[status] + " commission"}
              value={formatMoney(data.totals[status].commissionAmount)}
              hint={entryCountLabel(data.totals[status].count) + " - whole ledger"}
              active={state.status === status}
              onSelect={() => go({ ...state, status: state.status === status ? "" : status, page: 1 })}
            />
          ))}
        </div>
      ) : loading ? (
        <div className="grid gap-3 sm:grid-cols-2" aria-busy="true" aria-label="Loading ledger totals">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : null}

      <div className="relative" role="search">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          aria-label="Search the commission ledger"
          placeholder="Search by store name, store id, or settlement reference"
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
        label="Commission ledger"
        columns={COLUMNS}
        rows={data?.docs ?? []}
        rowKey={(entry) => entry.id}
        loading={loading}
        error={error ? error.message : null}
        onRetry={refetch}
        emptyTitle={filtered ? "No ledger entries match" : "No commission recorded yet"}
        emptyHint={filtered ? "Try a different search or clear the status filter." : "Entries appear here as orders are paid through the platform."}
      />

      {data ? (
        <TablePagination page={data.page} totalPages={data.totalPages} totalDocs={data.totalDocs} noun="entry" plural="entries" disabled={loading} onPage={(page) => go({ ...state, page })} />
      ) : null}
    </>
  );
}
