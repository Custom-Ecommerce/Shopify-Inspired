"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { StatusBadge } from "@/components/dashboard/shared/StatusBadge";
import { LoadingState } from "@/components/dashboard/shared/LoadingState";
import { ErrorState } from "@/components/dashboard/shared/ErrorState";
import { EmptyState } from "@/components/dashboard/shared/EmptyState";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import {
  CONTACT_STATUS_LIST,
  SUPPORT_LIMITS,
  closeContactMessage,
  contactStatusLabel,
  fetchContactMessage,
  fetchContactMessages,
  markContactRead,
  replyProblem,
  replyToContact,
  type ContactMessage,
  type SupportList,
} from "@/lib/support";

/**
 * Sprint 7 (S7-B4): the store's contact inbox. Messages shoppers sent through the store's contact form, newest first. Opening a new message marks it read.
 * A reply goes by email when the shopper gave one; otherwise it opens a WhatsApp chat with the reply typed in. Every write carries the message's version
 * (revision): if it changed elsewhere the screen asks to reload instead of overwriting. Text is shown as text, never as markup. One column from 375 px up.
 */
export default function InboxPage() {
  const storeFetch = useStoreFetch();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [list, setList] = useState<SupportList<ContactMessage> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await fetchContactMessages(storeFetch, status, page);
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
      <PageHeader title="Inbox" description="Messages from your store's contact form. Answer by email, or on WhatsApp when the shopper left only a phone number." />

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {["", ...CONTACT_STATUS_LIST].map((value) => (
          <Button
            key={value || "all"}
            type="button"
            variant={status === value ? "default" : "outline"}
            className="min-h-11"
            aria-pressed={status === value}
            onClick={() => {
              setStatus(value);
              setPage(1);
              setOpenId(null);
            }}
          >
            {value === "" ? "All" : contactStatusLabel(value)}
          </Button>
        ))}
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : list === null ? (
        <LoadingState />
      ) : list.docs.length === 0 ? (
        <EmptyState title="No messages" description={status === "" ? "When a shopper writes to your store, the message appears here." : "No message has this status."} />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Messages">
          {list.docs.map((item) => (
            <li key={item.id} className="rounded-xl border">
              <button
                type="button"
                className="flex min-h-11 w-full flex-col gap-1 p-4 text-left sm:flex-row sm:items-center sm:justify-between"
                aria-expanded={openId === item.id}
                onClick={() => setOpenId(openId === item.id ? null : item.id)}
              >
                <span className="min-w-0">
                  <span className={"block break-words " + (item.status === "new" ? "font-semibold" : "font-medium")}>{item.name}</span>
                  <span className="block break-words text-xs text-muted-foreground">{item.email || item.phone || "No contact given"}</span>
                  <span className="mt-1 line-clamp-2 block break-words text-sm text-muted-foreground">{item.message}</span>
                </span>
                <StatusBadge status={item.status} label={contactStatusLabel(item.status)} />
              </button>
              {openId === item.id ? (
                <MessageDetail
                  id={item.id}
                  onChanged={() => {
                    void load();
                  }}
                />
              ) : null}
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

function MessageDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const storeFetch = useStoreFetch();
  const [message, setMessage] = useState<ContactMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [waLink, setWaLink] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await fetchContactMessage(storeFetch, id);
    if (!result.ok) return setError(result.failure.message);
    setError(null);
    if (result.value.status === "new") {
      // Opening a new message marks it read. A conflict or failure here is harmless: the message simply stays new.
      const marked = await markContactRead(storeFetch, id, result.value.revision);
      setMessage(marked.ok ? marked.value : result.value);
      if (marked.ok) onChanged();
    } else {
      setMessage(result.value);
    }
  }, [storeFetch, id, onChanged]);

  useEffect(() => {
    void load();
    // load once per opened message
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!message) return;
    const why = replyProblem(text);
    if (why !== null) return setProblem(why);
    setBusy(true);
    setProblem(null);
    const result = await replyToContact(storeFetch, message.id, message.revision, text);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.failure.revisionConflict ? "This message was changed somewhere else. It has been reloaded: read it again, then answer." : result.failure.message);
      if (result.failure.revisionConflict) void load();
      return;
    }
    setMessage(result.value.message);
    setText("");
    setWaLink(result.value.whatsappLink);
    toast.success(result.value.channel === "whatsapp" ? "Reply saved. Open WhatsApp to send it." : "Reply sent by email.");
    onChanged();
  }

  async function close() {
    if (!message) return;
    setBusy(true);
    const result = await closeContactMessage(storeFetch, message.id, message.revision);
    setBusy(false);
    if (!result.ok) return setProblem(result.failure.message);
    setMessage(result.value);
    onChanged();
  }

  if (error) return <div className="border-t p-4"><ErrorState message={error} onRetry={() => void load()} /></div>;
  if (!message) return <div className="border-t p-4"><LoadingState /></div>;
  const closed = message.status === "closed";
  return (
    <div className="flex flex-col gap-4 border-t p-4 text-sm" data-slot="message-detail">
      <p className="whitespace-pre-wrap break-words">{message.message}</p>
      <p className="break-words text-xs text-muted-foreground">
        {message.email ? message.email : "No email"} {message.phone ? " · " + message.phone : ""}
      </p>

      {message.replies.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="Your replies">
          {message.replies.map((reply, index) => (
            <li key={index} className="rounded-lg bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">You · {reply.channel === "whatsapp" ? "WhatsApp" : "Email"}</p>
              <p className="mt-1 whitespace-pre-wrap break-words">{reply.text}</p>
            </li>
          ))}
        </ul>
      ) : null}

      {closed ? (
        <p className="text-muted-foreground">This message is closed.</p>
      ) : (
        <form onSubmit={send} className="flex flex-col gap-2" noValidate>
          <Textarea aria-label="Your reply" rows={4} value={text} maxLength={SUPPORT_LIMITS.reply.max} disabled={busy} onChange={(event) => setText(event.target.value)} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" variant="clay" className="min-h-11" disabled={busy}>
              {busy ? "Sending..." : message.email ? "Send reply by email" : "Save reply for WhatsApp"}
            </Button>
            <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void close()}>
              Close message
            </Button>
          </div>
        </form>
      )}

      {problem !== null ? (
        <p role="alert" className="text-destructive">
          {problem}
        </p>
      ) : null}

      {waLink ? (
        <Button variant="clay-soft" className="min-h-11 w-full sm:w-auto" render={<a href={waLink} target="_blank" rel="noopener noreferrer" />}>
          Open WhatsApp
        </Button>
      ) : message.waLink && !closed ? (
        <Button variant="clay-soft" className="min-h-11 w-full sm:w-auto" render={<a href={message.waLink} target="_blank" rel="noopener noreferrer" />}>
          Open WhatsApp chat
        </Button>
      ) : null}
    </div>
  );
}
