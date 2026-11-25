"use client";

import { useCallback, useMemo, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TablePagination } from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api/client";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useAdminFetch } from "@/lib/hooks/use-admin-fetch";
import {
  SUPPORT_TEXT_MAX,
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
  changeTicketStatus,
  fetchTicket,
  fetchTickets,
  parseSupportState,
  replyProblem,
  replyToTicket,
  supportStateToQuery,
  type SupportListState,
  type SupportResult,
  type TicketDetail,
  type TicketRow,
  type TicketStatus,
} from "@/lib/support";

/** A failed support call becomes the ApiError the shared fetch hook already knows how to show. */
function unwrap<T>(result: SupportResult<T>): T {
  if (result.ok) return result.value;
  throw new ApiError(result.failure.status, result.failure.message);
}

/**
 * The Support page at /support (Sprint 7, S7-B4): every seller's tickets, newest activity first. The message text is plain text and is only ever rendered as a
 * React text child (never as markup). Replying and changing the status carry the ticket's version (revision): a conflict asks to reload instead of overwriting.
 * One column of cards from 375 px up; the thread opens in a full-height drawer.
 */
export function SupportView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const state = useMemo(() => parseSupportState(searchParams, TICKET_STATUSES), [searchParams]);
  const [open, setOpen] = useState<string | null>(null);
  const go = useCallback(
    (next: SupportListState) => {
      const query = supportStateToQuery(next).replace(/(^|&)limit=\d+/, "");
      router.replace(query === "" || query === "&" ? pathname : pathname + "?" + query.replace(/^&/, ""));
    },
    [router, pathname],
  );
  const { data, error, loading, refetch } = useAdminFetch(async () => unwrap(await fetchTickets(state)), [state.page, state.status]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h2 className="font-heading mb-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Support</h2>
        <p className="text-sm text-muted-foreground">Tickets from sellers. A reply is emailed to the seller.</p>
      </div>

      <Select aria-label="Filter by status" className="sm:w-48" value={state.status} onChange={(event) => go({ status: event.target.value, page: 1 })}>
        <option value="">All statuses</option>
        {TICKET_STATUSES.map((status) => (
          <option key={status} value={status}>
            {TICKET_STATUS_LABELS[status]}
          </option>
        ))}
      </Select>

      {error !== null && (data?.docs.length ?? 0) === 0 ? (
        <Card role="alert" className="flex flex-col items-center gap-3 border-destructive/20 bg-destructive/8 px-6 py-10 text-center">
          <p className="max-w-sm text-sm font-medium text-foreground">{error.message}</p>
          <Button variant="outline" size="sm" onClick={refetch}>
            Try again
          </Button>
        </Card>
      ) : loading && !data ? (
        <div className="flex flex-col gap-3" aria-busy>
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : (data?.docs.length ?? 0) === 0 ? (
        <Card className="bg-muted/30 px-4 py-12 text-center">
          <p className="font-heading text-lg font-semibold text-foreground">No tickets</p>
          <p className="mt-1 text-sm text-muted-foreground">Nothing matches this filter.</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Tickets" data-slot="ticket-list">
          {data?.docs.map((ticket) => (
            <TicketCard key={ticket.id} ticket={ticket} onOpen={() => setOpen(ticket.id)} />
          ))}
        </ul>
      )}

      {data ? <TablePagination page={data.page} totalPages={data.totalPages} totalDocs={data.totalDocs} noun="ticket" disabled={loading} onPage={(page) => go({ ...state, page })} /> : null}
      {open !== null ? (
        <TicketDrawer
          key={open}
          id={open}
          onClose={() => {
            setOpen(null);
            refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function TicketCard({ ticket, onOpen }: { ticket: TicketRow; onOpen: () => void }) {
  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold">{ticket.subject}</p>
          <p className="break-words text-xs text-muted-foreground">{ticket.sellerName ?? ticket.sellerEmail ?? "Seller"}</p>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">{TICKET_STATUS_LABELS[ticket.status] ?? ticket.status}</span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {ticket.messageCount} {ticket.messageCount === 1 ? "message" : "messages"}
        {ticket.lastMessageAt ? " · " + formatRelative(ticket.lastMessageAt) : ""}
        {ticket.lastFrom === "seller" ? " · waiting for a reply" : ""}
      </p>
      <Button variant="outline" className="mt-3 min-h-11 w-full sm:w-auto" onClick={onOpen}>
        Open ticket
      </Button>
    </li>
  );
}

function TicketDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error, loading, refetch } = useAdminFetch(async () => unwrap(await fetchTicket(id)), [id]);
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const current = ticket ?? data;
  const closed = current?.status === "closed";

  async function run(action: () => Promise<SupportResult<TicketDetail>>, onDone?: () => void) {
    setBusy(true);
    setProblem(null);
    const result = await action();
    setBusy(false);
    if (result.ok) {
      setTicket(result.value);
      onDone?.();
      return;
    }
    setProblem(result.failure.revisionConflict ? "Someone changed this ticket. Reload it and try again." : result.failure.message);
    if (result.failure.revisionConflict) {
      setTicket(null);
      refetch();
    }
  }

  function send(event: FormEvent) {
    event.preventDefault();
    if (!current) return;
    const why = replyProblem(text);
    if (why !== null) return setProblem(why);
    void run(() => replyToTicket(current.id, current.revision, text), () => setText(""));
  }

  function setStatus(status: TicketStatus) {
    if (current) void run(() => changeTicketStatus(current.id, current.revision, status));
  }

  return (
    <Dialog open onClose={onClose} title={current ? current.subject : "Ticket"} description={current ? (current.sellerName ?? current.sellerEmail ?? "Seller") + " · " + (TICKET_STATUS_LABELS[current.status] ?? current.status) : undefined} className="sm:ml-auto sm:max-w-md">
      {loading && !current ? <Skeleton className="h-40 w-full" aria-busy /> : null}
      {error !== null && !current ? (
        <div role="alert" className="flex flex-col gap-2 text-sm text-destructive">
          <p>{error.message}</p>
          <Button variant="outline" size="sm" onClick={refetch}>
            Try again
          </Button>
        </div>
      ) : null}
      {current ? (
        <div className="flex flex-col gap-4 text-sm" data-slot="ticket-thread">
          <ul className="flex flex-col gap-3" aria-label="Messages">
            {current.messages.map((message, index) => (
              <li key={index} className={"rounded-lg border border-border p-3 " + (message.from === "admin" ? "bg-muted/40" : "")}>
                <p className="text-xs font-medium text-muted-foreground">
                  {message.from === "admin" ? "Support" : "Seller"} · {formatDateTime(message.at ?? "")}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words">{message.text}</p>
              </li>
            ))}
          </ul>

          {closed ? (
            <p className="text-muted-foreground">This ticket is closed. Reopen it to reply.</p>
          ) : (
            <form onSubmit={send} className="flex flex-col gap-2" noValidate>
              <Textarea aria-label="Reply" value={text} maxLength={SUPPORT_TEXT_MAX} rows={4} disabled={busy} onChange={(event) => setText(event.target.value)} />
              <Button type="submit" className="min-h-11" disabled={busy}>
                {busy ? "Sending..." : "Send reply"}
              </Button>
            </form>
          )}

          {problem !== null ? (
            <p role="alert" className="text-destructive">
              {problem}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {closed ? (
              <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => setStatus("open")}>
                Reopen
              </Button>
            ) : (
              <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => setStatus("closed")}>
                Close ticket
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
