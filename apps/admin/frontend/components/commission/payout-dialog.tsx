"use client";

import { useCallback, useState, type FormEvent } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createPayout, fetchPayoutDetails } from "@/lib/api/client";
import type { PayoutBalanceRow, PayoutFullDetails } from "@/lib/contracts";
import { useAdminMutation } from "@/lib/hooks/use-admin-mutation";
import { NOTE_MAX, PAYOUT_METHOD_LABELS, REFERENCE_MAX, describePayout, formatRupees, payoutFormIssues, type PayoutFormIssues } from "@/lib/payouts";

/**
 * Sprint 4 EP-05.US03 (D-088, D-090): record that a store was paid its whole balance. Two steps: the transfer details, then a
 * confirmation sentence. The amount is the balance the operator saw; if it moved the backend answers 409 and the dialog offers
 * a reload. "Show account details" fetches the FULL account number (audited on every press); it is kept in this dialog's
 * state only, never in storage, and is gone when the dialog closes.
 */
export function PayoutDialog({ row, onClose, onDone }: { row: PayoutBalanceRow; onClose: () => void; onDone: () => void }) {
  const method: string = row.payoutMethod ?? "";
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [issues, setIssues] = useState<PayoutFormIssues>({});
  const [confirming, setConfirming] = useState(false);
  const [details, setDetails] = useState<PayoutFullDetails | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsPending, setDetailsPending] = useState(false);

  const submit = useCallback(
    (input: { method: string; reference: string; note: string }) => createPayout({ storeId: row.storeId, expectedBalance: row.balance, ...input }),
    [row.storeId, row.balance],
  );
  const mutation = useAdminMutation(submit);

  async function showDetails() {
    setDetailsPending(true);
    setDetailsError(null);
    try {
      setDetails(await fetchPayoutDetails(row.storeId));
    } catch (err) {
      setDetailsError(err instanceof Error ? err.message : "The account details could not be loaded.");
    } finally {
      setDetailsPending(false);
    }
  }

  function next(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = payoutFormIssues({ method, reference, note });
    setIssues(found);
    if (Object.keys(found).length === 0) setConfirming(true);
  }

  async function confirm() {
    const result = await mutation.run({ method, reference, note });
    if (result === null) return;
    toast.success("Payout recorded. The seller is told by email.");
    onDone();
  }

  const stale = mutation.error?.status === 409;

  return (
    <Dialog open onClose={onClose} title="Pay this store" description={row.storeName + ": " + formatRupees(row.balance) + " (" + row.unsettledEntries + " ledger entries)"} busy={mutation.pending}>
      {confirming ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-foreground">{describePayout(row.storeName, row.balance, method, reference)}</p>
          {mutation.error ? (
            <p role="alert" className="text-sm text-destructive">
              {mutation.error.message}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {stale ? (
              <Button onClick={onDone}>Reload balances</Button>
            ) : (
              <Button onClick={() => void confirm()} disabled={mutation.pending}>
                {mutation.pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Confirm payout of {formatRupees(row.balance)}
              </Button>
            )}
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={mutation.pending}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={next} className="flex flex-col gap-3" noValidate>
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/30 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-muted-foreground">Seller account on file</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={detailsPending}
                onClick={() => (details ? setDetails(null) : void showDetails())}
                aria-expanded={details !== null}
              >
                {detailsPending ? <Loader2 className="animate-spin" aria-hidden /> : details ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                {details ? "Hide account details" : "Show account details"}
              </Button>
            </div>
            {details ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">Method</dt>
                <dd>{PAYOUT_METHOD_LABELS[details.method]}</dd>
                <dt className="text-muted-foreground">Account title</dt>
                <dd>{details.accountTitle}</dd>
                {details.bankName ? (
                  <>
                    <dt className="text-muted-foreground">Bank</dt>
                    <dd>{details.bankName}</dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">Account number</dt>
                <dd className="select-all font-mono">{details.accountNumber}</dd>
              </dl>
            ) : (
              <p className="text-muted-foreground">
                {row.payoutMethod ? PAYOUT_METHOD_LABELS[row.payoutMethod] + ", ending " + (row.payoutLast4 ?? "") : "No payout details"}. Showing the full number is recorded in the audit log.
              </p>
            )}
            {detailsError !== null ? (
              <p role="alert" className="text-destructive">
                {detailsError}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="payout-method">Sent by (the seller&apos;s saved method)</Label>
            <Input id="payout-method" readOnly value={PAYOUT_METHOD_LABELS[method as keyof typeof PAYOUT_METHOD_LABELS] ?? method} aria-invalid={issues.method !== undefined} />
            {issues.method !== undefined ? (
              <p role="alert" className="text-sm text-destructive">
                {issues.method}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="payout-reference">Transfer reference (required)</Label>
            <Input id="payout-reference" autoFocus maxLength={REFERENCE_MAX} value={reference} aria-invalid={issues.reference !== undefined} onChange={(event) => setReference(event.target.value)} />
            {issues.reference !== undefined ? (
              <p role="alert" className="text-sm text-destructive">
                {issues.reference}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="payout-note">Note (optional)</Label>
            <Textarea id="payout-note" rows={2} maxLength={NOTE_MAX} value={note} aria-invalid={issues.note !== undefined} onChange={(event) => setNote(event.target.value)} />
            {issues.note !== undefined ? (
              <p role="alert" className="text-sm text-destructive">
                {issues.note}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit">Review payout</Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
