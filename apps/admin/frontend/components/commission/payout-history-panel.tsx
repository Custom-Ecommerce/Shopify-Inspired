"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { PanelProps } from "@/lib/commission";
import { PayoutVoidDialog } from "@/components/commission/payout-void-dialog";
import { DataTable, TablePagination, type Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { finishPayout, listPayoutHistory } from "@/lib/api/client";
import type { PayoutRow } from "@/lib/contracts";
import { formatDateTime } from "@/lib/format";
import { useAdminFetch } from "@/lib/hooks/use-admin-fetch";
import { useAdminMutation } from "@/lib/hooks/use-admin-mutation";
import { PAYOUT_METHOD_LABELS, PAYOUT_STATUS_LABELS, PAYOUT_STATUS_VALUES, formatRupees, type PayoutStatusFilter } from "@/lib/payouts";

function columns(onVoid: (row: PayoutRow) => void, onFinish: (row: PayoutRow) => void, finishing: string | null): Array<Column<PayoutRow>> {
  return [
    { key: "date", header: "Date", cell: (row) => <span className="whitespace-nowrap text-sm">{formatDateTime(row.createdAt)}</span> },
    {
      key: "store",
      header: "Store",
      cell: (row) => (
        <Link href={"/stores/" + row.storeId} className="block max-w-48 truncate text-primary underline-offset-4 hover:underline">
          {row.storeName ?? "(unknown store)"}
        </Link>
      ),
    },
    { key: "amount", header: "Amount", className: "text-right", cell: (row) => <span className="font-medium tabular-nums">{formatRupees(row.amount)}</span> },
    {
      key: "transfer",
      header: "Sent by",
      className: "hidden md:table-cell",
      cell: (row) => (
        <div className="flex flex-col text-sm">
          <span>{PAYOUT_METHOD_LABELS[row.method]}</span>
          <span className="max-w-48 truncate text-xs text-muted-foreground">Ref {row.reference}</span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={row.status} label={PAYOUT_STATUS_LABELS[row.status]} />
          {row.status === "voided" && row.voidReason ? <span className="max-w-56 text-xs text-muted-foreground">{row.voidReason}</span> : null}
          {row.status === "failed" && row.failedReason ? <span className="max-w-56 text-xs text-muted-foreground">{row.failedReason}</span> : null}
          {row.status === "pending_settle" ? <span className="max-w-56 text-xs text-muted-foreground">A request stopped halfway. Finish or release it.</span> : null}
        </div>
      ),
    },
    {
      key: "actions",
      header: "Action",
      className: "text-right",
      cell: (row) =>
        row.status === "paid" ? (
          <Button variant="outline" size="sm" onClick={() => onVoid(row)} aria-label={"Void the payout to " + (row.storeName ?? "the store")}>
            Void
          </Button>
        ) : row.status === "pending_settle" ? (
          <Button size="sm" disabled={finishing === row.id} onClick={() => onFinish(row)} aria-label={"Finish or release the payout to " + (row.storeName ?? "the store")}>
            {finishing === row.id ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Finish or release
          </Button>
        ) : null,
    },
  ];
}

/** Sprint 4 EP-05.US03 (D-090): every payout with its status; void a paid one, finish or release a stuck one. */
export function PayoutHistoryPanel({ state, go }: PanelProps) {
  const [status, setStatus] = useState<PayoutStatusFilter | "">("");
  const [voiding, setVoiding] = useState<PayoutRow | null>(null);
  const { data, error, loading, refetch } = useAdminFetch((signal) => listPayoutHistory(state.page, status, signal), [state.page, status]);
  const finish = useAdminMutation(finishPayout);
  const [finishing, setFinishing] = useState<string | null>(null);

  useEffect(() => {
    if (data && data.totalPages > 0 && state.page > data.totalPages) go({ ...state, page: data.totalPages });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  async function onFinish(row: PayoutRow) {
    setFinishing(row.id);
    const result = await finish.run(row.id);
    setFinishing(null);
    if (result === null) return;
    toast.success(result.status === "paid" ? "Payout finished: it is paid." : "Payout released: its entries are open again.");
    refetch();
  }

  return (
    <>
      <Select
        aria-label="Filter by payout status"
        className="sm:w-56"
        value={status}
        onChange={(event) => {
          setStatus(event.target.value as PayoutStatusFilter | "");
          go({ ...state, page: 1 });
        }}
      >
        <option value="">All payouts</option>
        {PAYOUT_STATUS_VALUES.map((value) => (
          <option key={value} value={value}>
            {PAYOUT_STATUS_LABELS[value]}
          </option>
        ))}
      </Select>

      {finish.error ? (
        <p role="alert" className="text-sm text-destructive">
          {finish.error.message}
        </p>
      ) : null}
      {error && data ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/20 bg-destructive/8 px-5 py-4 text-sm text-foreground">
          <span>{error.message} The list shown may be out of date.</span>
          <Button variant="outline" size="sm" onClick={refetch}>
            Try again
          </Button>
        </div>
      ) : null}
      <DataTable
        label="Payout history"
        columns={columns(setVoiding, (row) => void onFinish(row), finishing)}
        rows={data?.docs ?? []}
        rowKey={(row) => row.id}
        loading={loading}
        error={error ? error.message : null}
        onRetry={refetch}
        emptyTitle={status !== "" ? "No payouts with this status" : "No payouts yet"}
        emptyHint={status !== "" ? "Choose another status." : "Payouts you record appear here."}
      />
      {data ? <TablePagination page={data.page} totalPages={data.totalPages} totalDocs={data.totalDocs} noun="payout" disabled={loading} onPage={(page) => go({ ...state, page })} /> : null}

      {voiding ? (
        <PayoutVoidDialog
          payout={voiding}
          onClose={() => setVoiding(null)}
          onDone={() => {
            setVoiding(null);
            refetch();
          }}
        />
      ) : null}
    </>
  );
}
