"use client";

import { useCallback, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { voidPayout } from "@/lib/api/client";
import type { PayoutRow } from "@/lib/contracts";
import { useAdminMutation } from "@/lib/hooks/use-admin-mutation";
import { VOID_REASON_MAX, VOID_REASON_MIN, describeVoid, formatRupees } from "@/lib/payouts";

/** Sprint 4 EP-05.US03 (D-090): take a paid payout back. A reason is required; the entries count in the balance again. */
export function PayoutVoidDialog({ payout, onClose, onDone }: { payout: PayoutRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const submit = useCallback((input: { reason: string }) => voidPayout(payout.id, input.reason), [payout.id]);
  const mutation = useAdminMutation(submit);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = reason.trim();
    if (trimmed.length < VOID_REASON_MIN || trimmed.length > VOID_REASON_MAX) {
      setFieldError("Give a reason of " + VOID_REASON_MIN + " to " + VOID_REASON_MAX + " characters.");
      return;
    }
    setFieldError(null);
    const result = await mutation.run({ reason: trimmed });
    if (result === null) return;
    toast.success("Payout voided. The seller is told by email.");
    onDone();
  }

  return (
    <Dialog open onClose={onClose} title="Void this payout?" description={(payout.storeName ?? "Store") + ": " + formatRupees(payout.amount) + ", ref " + payout.reference} busy={mutation.pending}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        <p className="text-sm text-muted-foreground">{describeVoid(payout.storeName ?? "the store", payout.amount)}</p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="payout-void-reason">Reason (required)</Label>
          <Textarea
            id="payout-void-reason"
            autoFocus
            required
            rows={3}
            maxLength={VOID_REASON_MAX}
            value={reason}
            aria-invalid={fieldError !== null}
            onChange={(event) => setReason(event.target.value)}
          />
          {fieldError !== null ? (
            <p role="alert" className="text-sm text-destructive">
              {fieldError}
            </p>
          ) : null}
        </div>
        {mutation.error ? (
          <p role="alert" className="text-sm text-destructive">
            {mutation.error.message}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="destructive" disabled={mutation.pending}>
            {mutation.pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Void payout
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={mutation.pending}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
