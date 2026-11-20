"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import type { PanelProps } from "@/lib/commission";
import { PayoutDialog } from "@/components/commission/payout-dialog";
import { ReportDialog } from "@/components/commission/report-dialog";
import { DataTable, TablePagination, type Column } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listPayoutBalances } from "@/lib/api/client";
import type { PayoutBalanceRow } from "@/lib/contracts";
import { useAdminFetch } from "@/lib/hooks/use-admin-fetch";
import { useDebouncedSearch } from "@/lib/hooks/use-debounced-search";
import { accountSummary, entriesLabel, formatRupees, payBlockReason } from "@/lib/payouts";

function columns(onPay: (row: PayoutBalanceRow) => void, onReport: (row: PayoutBalanceRow) => void): Array<Column<PayoutBalanceRow>> {
  return [
    {
      key: "store",
      header: "Store",
      cell: (row) => (
        <Link href={"/stores/" + row.storeId} className="block max-w-56 truncate text-primary underline-offset-4 hover:underline">
          {row.storeName}
        </Link>
      ),
    },
    {
      key: "balance",
      header: "Balance",
      className: "text-right",
      cell: (row) => (
        <div className="flex flex-col items-end">
          <span className={"font-medium tabular-nums " + (row.balance < 0 ? "text-destructive" : "text-foreground")}>{formatRupees(row.balance)}</span>
          <span className="text-xs text-muted-foreground">{entriesLabel(row.unsettledEntries)}</span>
        </div>
      ),
    },
    {
      key: "account",
      header: "Payout account",
      className: "hidden md:table-cell",
      cell: (row) => <span className="text-sm">{accountSummary(row.payoutMethod, row.payoutLast4)}</span>,
    },
    {
      key: "email",
      header: "Email",
      className: "hidden lg:table-cell",
      cell: (row) => (row.emailVerified ? <Badge variant="success">Verified</Badge> : <Badge variant="warning">Not verified</Badge>),
    },
    {
      key: "actions",
      header: "Action",
      className: "text-right",
      cell: (row) => {
        const blocked = payBlockReason(row);
        return (
          <div className="flex flex-col items-end gap-1">
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => onReport(row)} aria-label={"Commission report of " + row.storeName}>
                Report
              </Button>
              <Button size="sm" disabled={blocked !== null} onClick={() => onPay(row)} aria-label={"Pay " + row.storeName}>
                Pay
              </Button>
            </div>
            {blocked !== null ? <span className="max-w-56 text-right text-xs text-muted-foreground">{blocked}</span> : null}
          </div>
        );
      },
    },
  ];
}

/**
 * Sprint 4 EP-05.US03 (D-090): what the platform owes each store, from the ledger. A positive balance can be paid (when the seller
 * has payout details and a verified email); zero or negative carries forward into the next payout.
 */
export function PayoutsPanel({ state, go }: PanelProps) {
  const [paying, setPaying] = useState<PayoutBalanceRow | null>(null);
  const [reporting, setReporting] = useState<PayoutBalanceRow | null>(null);
  const [search, setSearch] = useDebouncedSearch(state.q, (q) => go({ ...state, q, page: 1 }));
  const { data, error, loading, refetch } = useAdminFetch((signal) => listPayoutBalances(state.page, state.q, signal), [state.page, state.q]);

  useEffect(() => {
    if (data && data.totalPages > 0 && state.page > data.totalPages) go({ ...state, page: data.totalPages });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <>
      <div className="relative" role="search">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          aria-label="Search stores"
          placeholder="Search by store name"
          className="pl-9"
          value={search}
          maxLength={100}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {error && data ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/20 bg-destructive/8 px-5 py-4 text-sm text-foreground">
          <span>{error.message} The balances shown may be out of date.</span>
          <Button variant="outline" size="sm" onClick={refetch}>
            Try again
          </Button>
        </div>
      ) : null}
      <DataTable
        label="Store balances"
        columns={columns(setPaying, setReporting)}
        rows={data?.docs ?? []}
        rowKey={(row) => row.storeId}
        loading={loading}
        error={error ? error.message : null}
        onRetry={refetch}
        emptyTitle={state.q !== "" ? "No stores match" : "Nothing to settle"}
        emptyHint={state.q !== "" ? "Try a different store name." : "Stores appear here once their orders write ledger entries that are not paid out yet."}
      />
      {data ? <TablePagination page={data.page} totalPages={data.totalPages} totalDocs={data.totalDocs} noun="store" disabled={loading} onPage={(page) => go({ ...state, page })} /> : null}

      {paying ? (
        <PayoutDialog
          row={paying}
          onClose={() => setPaying(null)}
          onDone={() => {
            setPaying(null);
            refetch();
          }}
        />
      ) : null}
      {reporting ? <ReportDialog store={{ id: reporting.storeId, name: reporting.storeName }} onClose={() => setReporting(null)} /> : null}
    </>
  );
}
