"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TablePagination } from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useAdminFetch } from "@/lib/hooks/use-admin-fetch";
import { CONTACT_STATUSES, CONTACT_STATUS_LABELS, fetchContactMessage, fetchContactMessages, parseSupportState, supportStateToQuery, type ContactRow, type SupportListState, type SupportResult } from "@/lib/support";

function unwrap<T>(result: SupportResult<T>): T {
  if (result.ok) return result.value;
  throw new ApiError(result.failure.status, result.failure.message);
}

/**
 * The Contact page at /contact (Sprint 7, S7-B4): messages sent through the platform's own contact form, read only. The text is plain text and is only ever
 * rendered as a React text child. The visitor is answered by email from the support mailbox, not from here.
 */
export function ContactView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const state = useMemo(() => parseSupportState(searchParams, CONTACT_STATUSES), [searchParams]);
  const [open, setOpen] = useState<string | null>(null);
  const go = useCallback(
    (next: SupportListState) => {
      const query = supportStateToQuery(next).replace(/(^|&)limit=\d+/, "").replace(/^&/, "");
      router.replace(query === "" ? pathname : pathname + "?" + query);
    },
    [router, pathname],
  );
  const { data, error, loading, refetch } = useAdminFetch(async () => unwrap(await fetchContactMessages(state)), [state.page, state.status]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h2 className="font-heading mb-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Contact messages</h2>
        <p className="text-sm text-muted-foreground">Messages from the platform's contact form, read only.</p>
      </div>

      <Select aria-label="Filter by status" className="sm:w-48" value={state.status} onChange={(event) => go({ status: event.target.value, page: 1 })}>
        <option value="">All statuses</option>
        {CONTACT_STATUSES.map((status) => (
          <option key={status} value={status}>
            {CONTACT_STATUS_LABELS[status]}
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
          <p className="font-heading text-lg font-semibold text-foreground">No messages</p>
          <p className="mt-1 text-sm text-muted-foreground">Nothing matches this filter.</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Contact messages" data-slot="contact-list">
          {data?.docs.map((message) => (
            <ContactCard key={message.id} message={message} onOpen={() => setOpen(message.id)} />
          ))}
        </ul>
      )}

      {data ? <TablePagination page={data.page} totalPages={data.totalPages} totalDocs={data.totalDocs} noun="message" disabled={loading} onPage={(page) => go({ ...state, page })} /> : null}
      {open !== null ? <ContactDrawer key={open} id={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function ContactCard({ message, onOpen }: { message: ContactRow; onOpen: () => void }) {
  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold">{message.name}</p>
          <p className="break-all text-xs text-muted-foreground">{message.email}</p>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">{CONTACT_STATUS_LABELS[message.status] ?? message.status}</span>
      </div>
      <p className="mt-2 line-clamp-2 break-words text-sm">{message.message}</p>
      <p className="text-xs text-muted-foreground">{message.createdAt ? formatRelative(message.createdAt) : ""}</p>
      <Button variant="outline" className="mt-3 min-h-11 w-full sm:w-auto" onClick={onOpen}>
        Open message
      </Button>
    </li>
  );
}

function ContactDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error, loading, refetch } = useAdminFetch(async () => unwrap(await fetchContactMessage(id)), [id]);
  return (
    <Dialog open onClose={onClose} title={data ? data.name : "Message"} description={data ? data.email + (data.createdAt ? " · " + formatDateTime(data.createdAt) : "") : undefined} className="sm:ml-auto sm:max-w-md">
      {loading && !data ? <Skeleton className="h-40 w-full" aria-busy /> : null}
      {error !== null && !data ? (
        <div role="alert" className="flex flex-col gap-2 text-sm text-destructive">
          <p>{error.message}</p>
          <Button variant="outline" size="sm" onClick={refetch}>
            Try again
          </Button>
        </div>
      ) : null}
      {data ? (
        <div className="flex flex-col gap-3 text-sm" data-slot="contact-detail">
          <p className="whitespace-pre-wrap break-words">{data.message}</p>
          {data.replies.length > 0 ? (
            <ul className="flex flex-col gap-2 border-t border-border pt-3" aria-label="Replies">
              {data.replies.map((reply, index) => (
                <li key={index} className="rounded-lg bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">{reply.by} · {reply.channel}{reply.at ? " · " + formatDateTime(reply.at) : ""}</p>
                  <p className="mt-1 whitespace-pre-wrap break-words">{reply.text}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
