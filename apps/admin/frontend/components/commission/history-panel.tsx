"use client";

import type { PanelProps } from "@/components/commission/ledger-panel";
import { DataTable, TablePagination, type Column } from "@/components/shared/data-table";
import { listRateHistory } from "@/lib/api/client";
import type { RateHistoryRow } from "@/lib/commission-rates";
import { formatDateTime, formatPercent } from "@/lib/format";
import { useAdminFetch } from "@/lib/hooks/use-admin-fetch";

const rateText = (mode: string | null, rate: number | null): string => (mode === "inherit" || rate === null ? "Platform default" : formatPercent(rate));

const COLUMNS: Array<Column<RateHistoryRow>> = [
  { key: "when", header: "When", cell: (row) => <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(row.createdAt)}</span> },
  { key: "what", header: "Rate of", cell: (row) => <span className="block max-w-48 truncate">{row.scope === "platform" ? "Platform default" : (row.store?.name ?? "(unknown store)")}</span> },
  {
    key: "change",
    header: "Change",
    cell: (row) => (
      <span className="tabular-nums">
        {row.scope === "platform" ? formatPercent(row.oldRate ?? 0) : rateText(row.oldMode, row.oldRate)} to {row.scope === "platform" ? formatPercent(row.newRate ?? 0) : rateText(row.newMode, row.newRate)}
      </span>
    ),
  },
  { key: "who", header: "By", className: "hidden md:table-cell", cell: (row) => <span className="block max-w-32 truncate font-mono text-xs">{row.actor}</span> },
  { key: "reason", header: "Reason", className: "hidden lg:table-cell", cell: (row) => <span className="block max-w-72 truncate text-muted-foreground">{row.reason}</span> },
];

/** The change history of commission rates, newest first: who, from what to what, when and why. */
export function HistoryPanel({ state, go }: PanelProps) {
  const { data, error, loading, refetch } = useAdminFetch((signal) => listRateHistory(state.page, signal), [state.page]);
  return (
    <>
      <DataTable
        label="Commission rate history"
        columns={COLUMNS}
        rows={data?.docs ?? []}
        rowKey={(row) => row.id}
        loading={loading}
        error={error ? error.message : null}
        onRetry={refetch}
        emptyTitle="No rate changes yet"
        emptyHint="Changes to a store's rate or the platform default appear here."
      />
      {data ? <TablePagination page={data.page} totalPages={data.totalPages} totalDocs={data.totalDocs} noun="change" disabled={loading} onPage={(page) => go({ ...state, page })} /> : null}
    </>
  );
}
