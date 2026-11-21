"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { listFailedEmails, retryFailedEmails } from "@/lib/api/client";
import { formatRelative } from "@/lib/format";
import { useAdminFetch } from "@/lib/hooks/use-admin-fetch";
import { failedEmailIds, kindLabel, retryResultText } from "@/lib/sync-ops";

/**
 * Failed emails (Sprint 6 S6-B7): kind, masked recipient, attempts, an error code and dates. The email's content is never sent to the console. Retry one or
 * all on the page (at most 100); the backend checks sync.manage, so a level without it simply sees the message below and no buttons that work.
 */
export function FailedEmailsSection() {
  const { data, error, loading, refetch } = useAdminFetch((signal) => listFailedEmails(signal), []);
  const [busy, setBusy] = useState(false);

  async function retry(ids: string[]) {
    setBusy(true);
    try {
      toast.success(retryResultText(await retryFailedEmails(ids), "email"));
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not retry.");
    } finally {
      setBusy(false);
    }
  }

  if (error !== null && !data) return null;
  const rows = data?.docs ?? [];
  return (
    <section aria-label="Failed emails" className="flex flex-col gap-3" data-slot="failed-emails">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-heading text-lg font-semibold">Failed emails</h3>
        {rows.length > 0 ? (
          <Button className="min-h-11 w-full sm:w-auto" variant="outline" disabled={busy} onClick={() => void retry(failedEmailIds(rows))}>
            Retry {rows.length > 100 ? 100 : rows.length} {rows.length === 1 ? "email" : "emails"}
          </Button>
        ) : null}
      </div>
      {loading && !data ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {data && rows.length === 0 ? <Card className="p-4 text-sm text-muted-foreground">No failed emails.</Card> : null}
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.id} className="rounded-xl border border-border bg-card p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{kindLabel(row.kind)}</span>
              <span className="break-all text-xs text-muted-foreground">{row.recipient}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {row.attempts} {row.attempts === 1 ? "attempt" : "attempts"} · {row.errorCode ?? "no error code"} · {formatRelative(row.updatedAt)}
            </p>
            <Button className="mt-2 min-h-11 w-full sm:w-auto" size="sm" variant="ghost" disabled={busy} onClick={() => void retry([row.id])}>
              Retry
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
