"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { DataTable, TablePagination, type Column } from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { listAudit } from "@/lib/api/client";
import { actionLabel, actorLabel, auditStateToQuery, entityHref, parseAuditListState, type AuditListState } from "@/lib/audit";
import type { AdminAuditEntry } from "@/lib/contracts";
import { formatDateTime, formatRelative, shortId } from "@/lib/format";
import { useAdminFetch } from "@/lib/hooks/use-admin-fetch";
import { useDebouncedSearch } from "@/lib/hooks/use-debounced-search";
import { statusLabel } from "@/lib/status";

const COLUMNS: Array<Column<AdminAuditEntry>> = [
  {
    key: "when",
    header: "When",
    cell: (entry) => (
      <time dateTime={entry.createdAt} title={formatDateTime(entry.createdAt)} className="whitespace-nowrap text-muted-foreground">
        {formatRelative(entry.createdAt)}
      </time>
    ),
  },
  {
    key: "action",
    header: "Action",
    cell: (entry) => (
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{actionLabel(entry.action)}</span>
        <span className="truncate text-xs text-muted-foreground">{entry.action}</span>
      </div>
    ),
  },
  {
    key: "target",
    header: "Target",
    className: "hidden md:table-cell",
    cell: (entry) => {
      const href = entityHref(entry.entity, entry.entityId);
      const label = entry.entity + " " + shortId(entry.entityId);
      return href ? (
        <Link href={href} className="text-primary underline-offset-4 hover:underline">
          {label}
        </Link>
      ) : (
        <span>{label}</span>
      );
    },
  },
  { key: "actor", header: "By", className: "hidden md:table-cell", cell: (entry) => <span>{actorLabel(entry.actor)}</span> },
  {
    key: "details",
    header: "Details",
    className: "hidden lg:table-cell",
    cell: (entry) => (
      <div className="flex min-w-0 flex-col gap-0.5">
        {entry.from && entry.to ? (
          <span>
            {statusLabel(entry.from)} to {statusLabel(entry.to)}
          </span>
        ) : null}
        {entry.reason ? <span className="line-clamp-2 break-words text-xs text-muted-foreground">{entry.reason}</span> : null}
        {!entry.from && !entry.reason ? <span className="text-muted-foreground">-</span> : null}
      </div>
    ),
  },
];

/** The audit log at /audit. Search, action filter, and page live in the URL. Entries are read only. */
export function AuditView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const state = useMemo(() => parseAuditListState(searchParams), [searchParams]);

  function go(next: AuditListState) {
    const query = auditStateToQuery(next);
    router.replace(query === "" ? pathname : pathname + "?" + query);
  }

  const [search, setSearch] = useDebouncedSearch(state.q, (q) => go({ ...state, q, page: 1 }));
  const { data, error, loading, refetch } = useAdminFetch((signal) => listAudit(state, signal), [state.page, state.q, state.action]);

  useEffect(() => {
    if (data && data.totalPages > 0 && state.page > data.totalPages) go({ ...state, page: data.totalPages });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const actions = useMemo(() => {
    const known = data?.facets.actions ?? [];
    return state.action !== "" && !known.includes(state.action) ? [state.action, ...known] : known;
  }, [data, state.action]);
  const filtered = state.q !== "" || state.action !== "";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h2 className="font-heading mb-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Audit log</h2>
        <p className="text-sm text-muted-foreground">Every change made from the console, newest first. Entries cannot be edited or removed.</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row" role="search">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            aria-label="Search the audit log"
            placeholder="Search by action, store id, or operator id"
            className="pl-9"
            value={search}
            maxLength={100}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Select aria-label="Filter by action" className="sm:w-56" value={state.action} onChange={(event) => go({ ...state, action: event.target.value, page: 1 })}>
          <option value="">All actions</option>
          {actions.map((action) => (
            <option key={action} value={action}>
              {actionLabel(action)}
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
        label="Audit log"
        columns={COLUMNS}
        rows={data?.docs ?? []}
        rowKey={(entry) => entry.id}
        loading={loading}
        error={error ? error.message : null}
        onRetry={refetch}
        emptyTitle={filtered ? "No entries match" : "No entries yet"}
        emptyHint={filtered ? "Try a different search or clear the action filter." : "Changes made from the console are recorded here."}
      />

      {data ? (
        <TablePagination page={data.page} totalPages={data.totalPages} totalDocs={data.totalDocs} noun="entry" plural="entries" disabled={loading} onPage={(page) => go({ ...state, page })} />
      ) : null}
    </div>
  );
}
