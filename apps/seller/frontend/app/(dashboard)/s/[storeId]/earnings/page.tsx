"use client";

import { useCallback, useEffect, useState } from "react";
import { Banknote, Coins, Percent, Scale, TrendingDown, Wallet } from "lucide-react";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { MetricTile } from "@/components/dashboard/shared/MetricTile";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { StatusBadge } from "@/components/dashboard/shared/StatusBadge";
import { DataTable } from "@/components/dashboard/shared/DataTable";
import { EmptyState } from "@/components/dashboard/shared/EmptyState";
import { ErrorState } from "@/components/dashboard/shared/ErrorState";
import { LoadingState } from "@/components/dashboard/shared/LoadingState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ENTRY_TYPES,
  ENTRY_TYPE_LABELS,
  EARNINGS_PERIODS,
  PAYOUT_METHOD_NAMES,
  PERIOD_LABELS,
  balanceHint,
  customRangeProblem,
  earningsQuery,
  entryLabel,
  formatPkr,
  formatSignedPkr,
  payoutStatusLabel,
  type EarningsData,
  type EarningsEntry,
  type EarningsPayout,
  type EarningsPeriodValue,
  type EntryTypeValue,
} from "@/lib/earnings";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";

const shortDate = (iso: string): string => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Karachi" });

/** The page says "an error" in the seller's words and keeps whatever the server said. */
async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown; errors?: Array<{ message?: unknown }> } | null;
  if (typeof body?.error === "string") return body.error;
  const first = body?.errors?.[0]?.message;
  return typeof first === "string" ? first : "Could not load your earnings. Try again.";
}

const entryColumns = [
  {
    header: "Date",
    className: "whitespace-nowrap",
    render: (entry: EarningsEntry) => <span className="text-xs text-muted-foreground tabular-nums">{shortDate(entry.createdAt)}</span>,
  },
  {
    header: "Order",
    render: (entry: EarningsEntry) => <span className="font-mono text-xs">{entry.orderNumber ?? "-"}</span>,
  },
  {
    header: "Type",
    render: (entry: EarningsEntry) => <span className="text-sm">{entryLabel(entry)}</span>,
  },
  {
    header: "Amount",
    className: "text-right",
    render: (entry: EarningsEntry) => <span className="tabular-nums font-medium">{formatSignedPkr(entry.amount)}</span>,
  },
  {
    header: "Rate",
    className: "hidden text-right sm:table-cell",
    render: (entry: EarningsEntry) => <span className="tabular-nums text-muted-foreground">{entry.rate}%</span>,
  },
  {
    header: "Paid out",
    className: "hidden md:table-cell",
    render: (entry: EarningsEntry) => <StatusBadge status={entry.settled ? "settled" : "pending"} label={entry.settled ? "Paid out" : "Waiting"} />,
  },
];

const payoutColumns = [
  {
    header: "Date",
    className: "whitespace-nowrap",
    render: (payout: EarningsPayout) => <span className="text-xs text-muted-foreground tabular-nums">{shortDate(payout.createdAt)}</span>,
  },
  {
    header: "Amount",
    className: "text-right",
    render: (payout: EarningsPayout) => <span className="tabular-nums font-medium">{formatPkr(payout.amount)}</span>,
  },
  {
    header: "Sent by",
    className: "hidden sm:table-cell",
    render: (payout: EarningsPayout) => <span className="text-sm">{PAYOUT_METHOD_NAMES[payout.method]}</span>,
  },
  {
    header: "Reference",
    render: (payout: EarningsPayout) => <span className="font-mono text-xs">{payout.reference}</span>,
  },
  {
    header: "Status",
    render: (payout: EarningsPayout) => <StatusBadge status={payout.status === "voided" ? "cancelled" : payout.status} label={payoutStatusLabel(payout.status)} />,
  },
];

/**
 * Sprint 4 EP-05.US04 (D-090). The seller's earnings, from the commission ledger through the BFF
 * (/api/dashboard/earnings -> GET /api/stores/:id/earnings): the summary of a period (Asia/Karachi days), what is waiting to be
 * paid out, the ledger rows and the payouts. Whole rupees. A custom range is asked for only once both days are valid.
 */
export default function DashboardEarningsPage() {
  const storeFetch = useStoreFetch();
  const [period, setPeriod] = useState<EarningsPeriodValue>("30");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [type, setType] = useState<EntryTypeValue | "">("");
  const [data, setData] = useState<EarningsData | null>(null);
  const [rate, setRate] = useState<{ rate: number; source: "custom" | "default" } | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const rangeProblem = period === "custom" ? customRangeProblem(from, to) : null;

  useEffect(() => {
    if (rangeProblem !== null) return;
    let cancelled = false;
    setLoading(true);
    setErrorMessage(null);
    storeFetch("/api/dashboard/earnings?" + earningsQuery({ period, from, to, page, type }))
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setErrorMessage(await readError(res));
          return;
        }
        setData((await res.json()) as EarningsData);
      })
      .catch(() => {
        if (!cancelled) setErrorMessage("Could not reach the server. Check your connection and try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period, from, to, page, type, tick, rangeProblem, storeFetch]);

  // The rate that applies now is read once; a failure just hides that line.
  useEffect(() => {
    let cancelled = false;
    storeFetch("/api/dashboard/commission")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { rate?: unknown; source?: unknown } | null) => {
        if (!cancelled && body && typeof body.rate === "number" && (body.source === "custom" || body.source === "default")) setRate({ rate: body.rate, source: body.source });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [storeFetch]);

  const retry = useCallback(() => setTick((n) => n + 1), []);

  const everythingEmpty =
    data !== null &&
    data.entries.totalDocs === 0 &&
    type === "" &&
    data.payouts.length === 0 &&
    data.allTime.balance === 0 &&
    data.allTime.totalPaidOut === 0 &&
    data.summary.sales === 0 &&
    data.summary.commission === 0;

  const periodSelector = (
    <Tabs
      value={period}
      onValueChange={(value) => {
        if (value) {
          setPeriod(value as EarningsPeriodValue);
          setPage(1);
        }
      }}
    >
      <TabsList>
        {EARNINGS_PERIODS.map((value) => (
          <TabsTrigger key={value} value={value}>
            {PERIOD_LABELS[value]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-8">
      <PageHeader title="Earnings" description="What your store sold, the commission, and what the platform pays out to you" className="mb-0">
        {periodSelector}
      </PageHeader>

      {period === "custom" ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="earnings-from">First day</Label>
            <Input id="earnings-from" type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="earnings-to">Last day</Label>
            <Input id="earnings-to" type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} />
          </div>
          {rangeProblem !== null ? <p className="text-sm text-muted-foreground">{rangeProblem}</p> : null}
        </div>
      ) : null}

      {errorMessage !== null ? (
        <ErrorState message={errorMessage} onRetry={retry} />
      ) : data === null ? (
        rangeProblem === null ? <LoadingState variant="skeleton" /> : null
      ) : everythingEmpty ? (
        <EmptyState
          title="No earnings yet"
          description="When orders are delivered and paid for, your sales, our commission and your payouts appear here."
          icon={<Banknote className="size-7" strokeWidth={1.5} />}
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {data.period.from === data.period.to ? data.period.from : data.period.from + " to " + data.period.to} (Pakistan time)
            {loading ? " - updating..." : ""}
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:gap-6">
            <MetricTile label="Sales" value={formatPkr(data.summary.sales)} icon={Coins} coinVariant="brand" />
            <MetricTile
              label="Commission"
              value={formatPkr(data.summary.commission)}
              icon={TrendingDown}
              action={rate !== null ? <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Percent className="size-3" aria-hidden="true" />{rate.rate}% {rate.source === "custom" ? "(your rate)" : "(standard rate)"}</span> : undefined}
            />
            <MetricTile label="Net earnings" value={formatPkr(data.summary.net)} icon={Wallet} className="col-span-2 md:col-span-1" />
          </div>

          <div className="grid grid-cols-2 gap-3 lg:gap-6">
            <MetricTile label="Waiting to be paid out" value={formatPkr(data.allTime.balance)} icon={Scale} action={<span className="text-xs text-muted-foreground">{balanceHint(data.allTime.balance)}</span>} />
            <MetricTile label="Paid out so far" value={formatPkr(data.allTime.totalPaidOut)} icon={Banknote} />
          </div>

          <SectionCard title="Ledger" description="Every sale and commission entry of this period" noPadding>
            <DataTable
              data={data.entries.docs}
              columns={entryColumns}
              keyExtractor={(entry) => entry.id}
              filterChips={[{ label: "All", value: "" }, ...ENTRY_TYPES.map((value) => ({ label: ENTRY_TYPE_LABELS[value], value }))]}
              activeFilter={type}
              onFilterChange={(value) => {
                setType(value as EntryTypeValue | "");
                setPage(1);
              }}
              emptyState={
                <EmptyState
                  title={type === "" ? "No entries in this period" : "No entries of this type"}
                  description={type === "" ? "Try a longer period." : "Choose another type or a longer period."}
                />
              }
            />
            {data.entries.totalPages > 1 ? (
              <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-3 text-sm">
                <span className="text-muted-foreground">
                  Page {data.entries.page} of {data.entries.totalPages} ({data.entries.totalDocs} entries)
                </span>
                <div className="flex gap-2">
                  <Button variant="clay-soft" size="sm" disabled={loading || data.entries.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                    Previous
                  </Button>
                  <Button variant="clay-soft" size="sm" disabled={loading || data.entries.page >= data.entries.totalPages} onClick={() => setPage((current) => current + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </SectionCard>

          <SectionCard title="Payouts" description="Money the platform sent to your payout account" noPadding>
            {data.payouts.length === 0 ? (
              <div className="px-5 py-5">
                <EmptyState title="No payouts yet" description="Your first payout appears here once the platform sends your earnings." />
              </div>
            ) : (
              <DataTable data={data.payouts} columns={payoutColumns} keyExtractor={(payout) => payout.id} />
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}
