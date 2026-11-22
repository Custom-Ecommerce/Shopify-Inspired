"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { StatusBadge } from "@/components/dashboard/shared/StatusBadge";
import { LoadingState } from "@/components/dashboard/shared/LoadingState";
import { ErrorState } from "@/components/dashboard/shared/ErrorState";
import { EmptyState } from "@/components/dashboard/shared/EmptyState";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { useStoreHref } from "@/lib/dashboard-context";
import { TICKET_STATUS_LIST, fetchTickets, ticketStatusLabel, type SupportList, type TicketItem } from "@/lib/support";

/** Sprint 7 (S7-B4): the seller's own support tickets, most recently active first. One column from 375 px up. */
export default function SupportPage() {
  const storeFetch = useStoreFetch();
  const href = useStoreHref();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [list, setList] = useState<SupportList<TicketItem> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await fetchTickets(storeFetch, status, page);
    if (result.ok) {
      setList(result.value);
      setError(null);
    } else {
      setError(result.failure.message);
    }
  }, [storeFetch, status, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="p-4 sm:p-8">
      <PageHeader title="Support" description="Ask the Markazify team for help. Answers arrive here and by email.">
        <Button variant="clay" className="min-h-11" render={<Link href={href("/support/new")} />}>
          New ticket
        </Button>
      </PageHeader>

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {["", ...TICKET_STATUS_LIST].map((value) => (
          <Button
            key={value || "all"}
            type="button"
            variant={status === value ? "default" : "outline"}
            className="min-h-11"
            aria-pressed={status === value}
            onClick={() => {
              setStatus(value);
              setPage(1);
            }}
          >
            {value === "" ? "All" : ticketStatusLabel(value)}
          </Button>
        ))}
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : list === null ? (
        <LoadingState />
      ) : list.docs.length === 0 ? (
        <EmptyState title="No tickets" description="When you need help, open a ticket and the team will answer here." />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Tickets">
          {list.docs.map((ticket) => (
            <li key={ticket.id} className="flex flex-col gap-2 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="break-words font-medium">{ticket.subject}</p>
                <p className="text-xs text-muted-foreground">
                  {ticket.messageCount} {ticket.messageCount === 1 ? "message" : "messages"}
                  {ticket.lastFrom === "admin" ? " · the team replied" : ""}
                </p>
              </div>
              <div className="flex items-center justify-between gap-3 sm:justify-end">
                <StatusBadge status={ticket.status} label={ticketStatusLabel(ticket.status)} />
                <Button variant="outline" className="min-h-11" render={<Link href={href(`/support/${ticket.id}`)} />}>
                  Open
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {list && list.totalPages > 1 ? (
        <div className="mt-6 flex items-center justify-between gap-3 text-sm">
          <Button type="button" variant="outline" className="min-h-11" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Previous
          </Button>
          <span aria-live="polite">
            Page {list.page} of {list.totalPages}
          </span>
          <Button type="button" variant="outline" className="min-h-11" disabled={page >= list.totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}
