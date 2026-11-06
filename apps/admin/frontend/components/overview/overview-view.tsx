"use client";

import Link from "next/link";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getOverview } from "@/lib/api/client";
import type { AdminOverview } from "@/lib/contracts";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useAdminFetch } from "@/lib/hooks/use-admin-fetch";
import { ledgerRows, outboxRows, overviewTiles, storeRows, updatedLabel, type OverviewRow, type OverviewTile } from "@/lib/overview";

function TileCard({ tile }: { tile: OverviewTile }) {
  return (
    <Link href={tile.href} className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="h-full p-5 transition-[box-shadow,border-color] duration-200 hover:border-primary/30 hover:shadow-md motion-reduce:transition-none">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-medium tracking-wide text-muted-foreground">{tile.title}</h3>
          {tile.badge !== null ? <Badge variant={tile.badge.tone}>{tile.badge.label}</Badge> : null}
        </div>
        <p className="mt-3 text-2xl font-bold tabular-nums tracking-tight text-foreground sm:text-3xl">{tile.value}</p>
        <p className="mt-2 text-xs text-muted-foreground">{tile.hint}</p>
      </Card>
    </Link>
  );
}

function TilesSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-label="Loading overview">
      {[0, 1, 2, 3].map((index) => (
        <Card key={index} className="flex flex-col gap-3 p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-full max-w-48" />
        </Card>
      ))}
    </div>
  );
}

function RowsCard({ title, description, rows, footer }: { title: string; description: string; rows: OverviewRow[]; footer?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col gap-1">
          {rows.map((row) => (
            <li key={row.status}>
              <Link href={row.href} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <StatusBadge status={row.status} label={row.label} />
                  {row.detail !== null ? <span className="truncate text-xs text-muted-foreground">{row.detail}</span> : null}
                </span>
                <span className="font-medium tabular-nums">{row.count}</span>
              </Link>
            </li>
          ))}
        </ul>
        {footer}
      </CardContent>
    </Card>
  );
}

function Moment({ label, iso }: { label: string; iso: string | null }) {
  return (
    <p className="text-xs text-muted-foreground">
      {label}:{" "}
      {iso === null ? (
        "never"
      ) : (
        <time dateTime={iso} title={formatDateTime(iso)}>
          {formatRelative(iso)}
        </time>
      )}
    </p>
  );
}

function OverviewBody({ overview }: { overview: AdminOverview }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {overviewTiles(overview).map((tile) => (
          <TileCard key={tile.key} tile={tile} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <RowsCard title="Stores by status" description="Open the store list on one status." rows={storeRows(overview)} />
        <RowsCard title="Commission ledger" description="Totals over the whole ledger. Amounts are in rupees." rows={ledgerRows(overview)} />
        <RowsCard
          title="Sync outbox"
          description="Events queued for the seller backend."
          rows={outboxRows(overview)}
          footer={
            <div className="flex flex-col gap-0.5 px-2">
              <Moment label="Oldest pending queued" iso={overview.outbox.oldestPendingAt} />
              <Moment label="Last event sent" iso={overview.outbox.lastSentAt} />
            </div>
          }
        />
      </div>
    </>
  );
}

/** The overview at /: four headline tiles and three breakdowns, all from one backend call. Loading, error with retry, refresh. */
export function OverviewView() {
  const { data, error, loading, refetch } = useAdminFetch((signal) => getOverview(signal), []);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading mb-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Overview</h2>
          <p className="text-sm text-muted-foreground">Operator console for the Markazify platform.</p>
        </div>
        <div className="flex items-center gap-3">
          {data !== null ? (
            <time dateTime={data.generatedAt} title={formatDateTime(data.generatedAt)} className="text-xs text-muted-foreground">
              {updatedLabel(data.generatedAt)}
            </time>
          ) : null}
          <Button variant="outline" size="sm" onClick={refetch} disabled={loading} aria-label="Refresh overview">
            <RefreshCw className={loading ? "animate-spin" : undefined} aria-hidden />
            Refresh
          </Button>
        </div>
      </div>

      {data !== null && error !== null ? (
        <Card role="alert" className="flex flex-wrap items-center justify-between gap-3 border-destructive/20 bg-destructive/8 px-5 py-4">
          <p className="text-sm text-destructive">{error.message}</p>
          <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
            Try again
          </Button>
        </Card>
      ) : null}

      {data !== null ? (
        <OverviewBody overview={data} />
      ) : error !== null ? (
        <Card role="alert" className="flex flex-col items-center gap-4 border-destructive/20 bg-destructive/8 px-6 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl border border-destructive/20 bg-destructive/10">
            <TriangleAlert className="size-6 text-destructive" aria-hidden />
          </span>
          <p className="max-w-sm text-sm font-medium text-foreground">{error.message}</p>
          <Button variant="outline" size="sm" onClick={refetch}>
            Try again
          </Button>
        </Card>
      ) : (
        <TilesSkeleton />
      )}
    </div>
  );
}
