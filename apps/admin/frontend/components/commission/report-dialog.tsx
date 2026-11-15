"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { commissionReportCsvUrl, getCommissionReport } from "@/lib/api/client";
import { useAdminFetch } from "@/lib/hooks/use-admin-fetch";
import { REPORT_PERIODS, REPORT_PERIOD_LABELS, formatRupees, reportInputIssue, type ReportPeriodValue } from "@/lib/payouts";

/**
 * Sprint 4 EP-05.US06 (D-090): the commission report of one store and period, summed from the ledger, with a CSV of the same
 * numbers. Periods are Asia/Karachi days; for a custom range both days are included.
 */
export function ReportDialog({ store, onClose }: { store: { id: string; name: string }; onClose: () => void }) {
  const [period, setPeriod] = useState<ReportPeriodValue>("30");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const issue = reportInputIssue({ period, from, to });
  const input = { storeId: store.id, period, from, to };
  const { data, error, loading, refetch } = useAdminFetch(
    async (signal) => (issue === null ? getCommissionReport(input, signal) : null),
    [store.id, period, from, to],
  );

  return (
    <Dialog open onClose={onClose} title="Commission report" description={store.name}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="report-period">Period</Label>
          <Select id="report-period" value={period} onChange={(event) => setPeriod(event.target.value as ReportPeriodValue)}>
            {REPORT_PERIODS.map((value) => (
              <option key={value} value={value}>
                {REPORT_PERIOD_LABELS[value]}
              </option>
            ))}
          </Select>
        </div>
        {period === "custom" ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="report-from">First day</Label>
              <Input id="report-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="report-to">Last day</Label>
              <Input id="report-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </div>
          </div>
        ) : null}
        {issue !== null ? <p className="text-sm text-muted-foreground">{issue}</p> : null}

        {issue === null && loading && data === null ? (
          <div aria-busy="true" aria-label="Loading the report">
            <Skeleton className="h-28" />
          </div>
        ) : null}
        {issue === null && error !== null ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 text-sm text-destructive">
            <span>{error.message}</span>
            <Button variant="outline" size="sm" onClick={refetch}>
              Try again
            </Button>
          </div>
        ) : null}
        {issue === null && data ? (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl border border-border p-3">
              <dt className="text-muted-foreground">Commission earned</dt>
              <dd className="text-xl font-bold tabular-nums">{formatRupees(data.commissionEarned)}</dd>
            </div>
            <div className="rounded-xl border border-border p-3">
              <dt className="text-muted-foreground">Sales</dt>
              <dd className="text-xl font-bold tabular-nums">{formatRupees(data.sales)}</dd>
            </div>
            <div className="rounded-xl border border-border p-3">
              <dt className="text-muted-foreground">Orders</dt>
              <dd className="text-xl font-bold tabular-nums">{data.ordersCount}</dd>
            </div>
            <div className="rounded-xl border border-border p-3">
              <dt className="text-muted-foreground">Balance now</dt>
              <dd className="text-xl font-bold tabular-nums">{formatRupees(data.balance)}</dd>
            </div>
            <p className="col-span-2 text-xs text-muted-foreground">
              {data.period.from} to {data.period.to} (Asia/Karachi). Sales are the item subtotals the commission was taken on, delivery excluded.
            </p>
          </dl>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {issue === null ? (
            <a href={commissionReportCsvUrl(input)} download className={buttonVariants({ variant: "outline" })}>
              <Download aria-hidden />
              Download CSV
            </a>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
