"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { DataTable, TablePagination, type Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getSyncOutbox } from "@/lib/api/client";
import type { AdminSyncEvent, AdminSyncOutbox } from "@/lib/contracts";
import { formatDateTime, formatRelative, shortId } from "@/lib/format";
import { useAdminFetch } from "@/lib/hooks/use-admin-fetch";
import { SYNC_STATUS_LABELS, SYNC_STATUS_VALUES, parseSyncListState, syncHealth, syncStateToQuery, type SyncListState, type SyncStatusValue } from "@/lib/sync";
import { cn } from "@/lib/utils";

function whenOf(event: AdminSyncEvent): { label: string; iso: string } {
  if (event.status === "sent" && event.sentAt) return { label: "Sent " + formatRelative(event.sentAt), iso: event.sentAt };
  if (event.status === "pending" && event.nextAttemptAt) return { label: "Next try " + formatRelative(event.nextAttemptAt), iso: event.nextAttemptAt };
  return { label: "Queued " + formatRelative(event.createdAt), iso: event.createdAt };
}

const COLUMNS: Array<Column<AdminSyncEvent>> = [
  {
    key: "event",
    header: "Event",
    cell: (event) => (
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium">
          {event.entity} - {event.group}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {shortId(event.entityId)} - revision {event.revision}
        </span>
      </div>
    ),
  },
  { key: "target", header: "Target", className: "hidden md:table-cell", cell: (event) => <span className="capitalize">{event.target}</span> },
  {
    key: "status",
    header: "Status",
    cell: (event) => <StatusBadge status={event.status} label={SYNC_STATUS_LABELS[event.status]} />,
  },
  { key: "attempts", header: "Attempts", className: "hidden md:table-cell", cell: (event) => <span>{event.attempts}</span> },
  {
    key: "when",
    header: "When",
    className: "hidden lg:table-cell",
    cell: (event) => {
      const when = whenOf(event);
      return (
        <time dateTime={when.iso} title={formatDateTime(when.iso)} className="text-muted-foreground">
          {when.label}
        </time>
      );
    },
  },
  {
    key: "error",
    header: "Last error",
    className: "hidden lg:table-cell",
    cell: (event) =>
      event.lastError ? (
        <span className="line-clamp-2 break-words text-xs text-muted-foreground" title={event.lastError}>
          {event.lastError}
        </span>
      ) : (
        <span className="text-muted-foreground">-</span>
      ),
  },
];

function CountTile({ status, count, active, onSelect }: { status: SyncStatusValue; count: number; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-1 rounded-2xl border border-border bg-card p-5 text-left shadow-sm transition-[box-shadow,border-color] duration-200 hover:border-primary/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
        active && "ring-2 ring-ring",
      )}
    >
      <span className="text-sm font-medium tracking-wide text-muted-foreground">{SYNC_STATUS_LABELS[status]}</span>
      <span className={cn("mt-2 text-2xl font-bold tabular-nums tracking-tight text-foreground sm:text-3xl", status === "dead" && count > 0 && "text-status-danger")}>{count}</span>
    </button>
  );
}

function Summary({ outbox, loading, onRefresh }: { outbox: AdminSyncOutbox; loading: boolean; onRefresh: () => void }) {
  const health = syncHealth(outbox.counts, outbox.oldestPendingAt);
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <CardTitle>Outbox health</CardTitle>
            <Badge variant={health.tone}>{health.label}</Badge>
          </div>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={cn(loading && "animate-spin")} aria-hidden />
            Refresh
          </Button>
        </div>
        <CardDescription>{health.detail}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Oldest pending event</dt>
            <dd className="text-sm">{outbox.oldestPendingAt ? formatRelative(outbox.oldestPendingAt) : "None waiting"}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Last event sent</dt>
            <dd className="text-sm">{outbox.lastSentAt ? formatRelative(outbox.lastSentAt) : "Nothing sent yet"}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

/** The sync outbox at /sync: health, the counts as filters, and a page of events. Read only. */
export function SyncView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const state = useMemo(() => parseSyncListState(searchParams), [searchParams]);

  function go(next: SyncListState) {
    const query = syncStateToQuery(next);
    router.replace(query === "" ? pathname : pathname + "?" + query);
  }

  const { data, error, loading, refetch } = useAdminFetch((signal) => getSyncOutbox(state, signal), [state.page, state.status]);

  useEffect(() => {
    if (data && data.events.totalPages > 0 && state.page > data.events.totalPages) go({ ...state, page: data.events.totalPages });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h2 className="font-heading mb-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Sync</h2>
        <p className="text-sm text-muted-foreground">Delivery of platform changes to the seller side. Dead letters are events that could not be delivered.</p>
      </div>

      {data ? (
        <>
          <Summary outbox={data} loading={loading} onRefresh={refetch} />
          <div className="grid gap-3 sm:grid-cols-3" role="group" aria-label="Filter events by status">
            {SYNC_STATUS_VALUES.map((status) => (
              <CountTile key={status} status={status} count={data.counts[status]} active={state.status === status} onSelect={() => go({ page: 1, status })} />
            ))}
          </div>
        </>
      ) : loading ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading outbox health">
          <Skeleton className="h-36" />
          <div className="grid gap-3 sm:grid-cols-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        </div>
      ) : null}

      {error && data ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/20 bg-destructive/8 px-5 py-4 text-sm text-foreground">
          <span>{error.message} The figures shown may be out of date.</span>
          <Button variant="outline" size="sm" onClick={refetch}>
            Try again
          </Button>
        </div>
      ) : null}
      <DataTable
        label="Sync events"
        columns={COLUMNS}
        rows={data?.events.docs ?? []}
        rowKey={(event) => event.id}
        loading={loading}
        error={error ? error.message : null}
        onRetry={refetch}
        emptyTitle={state.status === "dead" ? "No dead letters" : "No " + SYNC_STATUS_LABELS[state.status].toLowerCase() + " events"}
        emptyHint={state.status === "dead" ? "Every event has been delivered or is still being retried." : "Events appear here as the platform queues changes for sellers."}
      />

      {data ? (
        <TablePagination page={data.events.page} totalPages={data.events.totalPages} totalDocs={data.events.totalDocs} noun="event" disabled={loading} onPage={(page) => go({ ...state, page })} />
      ) : null}
    </div>
  );
}
