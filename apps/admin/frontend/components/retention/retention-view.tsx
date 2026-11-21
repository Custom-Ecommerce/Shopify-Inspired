"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { RetentionRunResponse } from "@markaz/contracts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApiError, runRetentionNow } from "@/lib/api/client";
import { canApply, retentionLines, retentionTotal } from "@/lib/sync-ops";

/**
 * The Retention page at /retention (Sprint 6 S6-B7, CO-25). Owner level only. Run a DRY RUN first: it counts what is past its period. Only then can you apply,
 * after one more confirmation. Every run is audited. The commission ledger, the audit log and subscription payments are never purged.
 */
export function RetentionView() {
  const [run, setRun] = useState<RetentionRunResponse | null>(null);
  const [pending, setPending] = useState<"dry" | "apply" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go(apply: boolean) {
    setPending(apply ? "apply" : "dry");
    setError(null);
    try {
      const result = await runRetentionNow(apply);
      setRun(result);
      setConfirming(false);
      if (apply) toast.success("Retention run finished");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h2 className="font-heading mb-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Retention</h2>
        <p className="text-sm text-muted-foreground">Remove old technical records. The commission ledger, the audit log and subscription payments are never removed.</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button className="min-h-11" variant="outline" disabled={pending !== null} onClick={() => void go(false)}>
          {pending === "dry" ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Dry run (count only)
        </Button>
        {canApply(run) && !confirming ? (
          <Button className="min-h-11" variant="destructive" disabled={pending !== null} onClick={() => setConfirming(true)}>
            Apply
          </Button>
        ) : null}
      </div>
      {confirming ? (
        <Card role="alertdialog" className="flex flex-col gap-3 border-destructive/30 p-4" data-slot="apply-confirm">
          <p className="text-sm">This removes {run ? retentionTotal(run) : 0} records for good (at most one batch per kind per run). Continue?</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="min-h-11" variant="destructive" disabled={pending !== null} onClick={() => void go(true)}>
              {pending === "apply" ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Yes, remove them
            </Button>
            <Button className="min-h-11" variant="ghost" onClick={() => setConfirming(false)} disabled={pending !== null}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}
      {error !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {run !== null ? (
        <Card className="p-4" data-slot="retention-result">
          <p className="mb-2 text-sm font-medium">{run.dryRun ? "Dry run: nothing was removed" : "Applied"}</p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {retentionLines(run).map((line) => (
              <li key={line.key} className="flex flex-wrap justify-between gap-2">
                <span>{line.label}</span>
                <span className="tabular-nums text-muted-foreground">{line.text}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
