"use client";

import { use, useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { StatusBadge } from "@/components/dashboard/shared/StatusBadge";
import { LoadingState } from "@/components/dashboard/shared/LoadingState";
import { ErrorState } from "@/components/dashboard/shared/ErrorState";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { SUPPORT_LIMITS, closeTicket, fetchTicket, replyProblem, replyToTicket, ticketStatusLabel, type TicketItem } from "@/lib/support";

/**
 * Sprint 7 (S7-B4): one of the seller's tickets as a thread. Messages are plain text shown as React text, never as markup. A reply or a close carries the
 * ticket's version (revision); when it changed elsewhere (the team answered meanwhile) the thread is reloaded instead of overwritten. Someone else's ticket is a 404.
 */
export default function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const storeFetch = useStoreFetch();
  const [ticket, setTicket] = useState<TicketItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await fetchTicket(storeFetch, id);
    if (result.ok) {
      setTicket(result.value);
      setError(null);
    } else {
      setError(result.status === 404 ? "This ticket was not found." : result.failure.message);
    }
  }, [storeFetch, id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!ticket) return;
    const why = replyProblem(text);
    if (why !== null) return setProblem(why);
    setBusy(true);
    setProblem(null);
    const result = await replyToTicket(storeFetch, ticket.id, ticket.revision, text);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.failure.revisionConflict ? "The team answered while you were writing. The thread was reloaded: read it, then send again." : result.failure.message);
      if (result.failure.revisionConflict) void load();
      return;
    }
    setTicket(result.value);
    setText("");
  }

  async function close() {
    if (!ticket) return;
    setBusy(true);
    setProblem(null);
    const result = await closeTicket(storeFetch, ticket.id, ticket.revision);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.failure.message);
      if (result.failure.revisionConflict) void load();
      return;
    }
    setTicket(result.value);
  }

  if (error) return <div className="p-4 sm:p-8"><ErrorState message={error} onRetry={() => void load()} /></div>;
  if (!ticket) return <div className="p-4 sm:p-8"><LoadingState /></div>;
  const closed = ticket.status === "closed";
  return (
    <div className="p-4 sm:p-8">
      <PageHeader title={ticket.subject} description={ticket.orderRef ? "About order " + ticket.orderRef : undefined}>
        <StatusBadge status={ticket.status} label={ticketStatusLabel(ticket.status)} />
      </PageHeader>

      <ul className="flex max-w-2xl flex-col gap-3" aria-label="Messages" data-slot="ticket-thread">
        {(ticket.messages ?? []).map((message, index) => (
          <li key={index} className={"rounded-xl border p-4 " + (message.from === "admin" ? "bg-muted/40" : "")}>
            <p className="text-xs font-medium text-muted-foreground">{message.from === "admin" ? "Markazify support" : "You"}</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">{message.text}</p>
          </li>
        ))}
      </ul>

      <div className="mt-6 max-w-2xl">
        {closed ? (
          <p className="text-sm text-muted-foreground">This ticket is closed. Open a new ticket if you need more help.</p>
        ) : (
          <form onSubmit={send} className="flex flex-col gap-2" noValidate>
            <Textarea aria-label="Your reply" rows={5} value={text} maxLength={SUPPORT_LIMITS.reply.max} disabled={busy} onChange={(e) => setText(e.target.value)} />
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="submit" variant="clay" className="min-h-11" disabled={busy}>
                {busy ? "Sending..." : "Send reply"}
              </Button>
              <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void close()}>
                Close ticket
              </Button>
            </div>
          </form>
        )}
        {problem !== null ? <p role="alert" className="mt-3 text-sm text-destructive">{problem}</p> : null}
      </div>
    </div>
  );
}
