"use client";

import { useCallback, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { changeSellerStatus } from "@/lib/api/client";
import type { AdminSellerListItem } from "@/lib/contracts";
import { useAdminMutation } from "@/lib/hooks/use-admin-mutation";

const REASON_MIN = 3;
const REASON_MAX = 300;

/**
 * Sprint 4 EP-08.US03.T02: suspend (a reason is required) or unsuspend one seller account, with an explicit confirm.
 * The seller's storefront stays up (D-093); only the account's sign-in and dashboard are refused.
 */
export function SellerStatusDialog({ seller, onClose, onDone }: { seller: AdminSellerListItem; onClose: () => void; onDone: () => void }) {
  const suspending = seller.accountStatus !== "suspended";
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const submit = useCallback(
    (input: { reason: string }) => changeSellerStatus(seller.id, suspending ? { status: "suspended", reason: input.reason } : { status: "active" }),
    [seller.id, suspending],
  );
  const mutation = useAdminMutation(submit);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = reason.trim();
    if (suspending && (trimmed.length < REASON_MIN || trimmed.length > REASON_MAX)) {
      setFieldError("Give a reason of " + REASON_MIN + " to " + REASON_MAX + " characters.");
      return;
    }
    setFieldError(null);
    const result = await mutation.run({ reason: trimmed });
    if (result === null) return;
    toast.success(suspending ? "Seller suspended." : "Seller unsuspended.");
    onDone();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={suspending ? "Suspend this seller?" : "Unsuspend this seller?"}
      description={seller.name + " (" + seller.email + ")"}
      busy={mutation.pending}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        <p className="text-sm text-muted-foreground">
          {suspending
            ? "The seller is signed out within 30 seconds and cannot sign in. Their storefront stays up unless you take the store down."
            : "The seller can sign in and use the dashboard again."}
        </p>
        {suspending ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="seller-suspend-reason">Reason (required)</Label>
            <Textarea
              id="seller-suspend-reason"
              autoFocus
              required
              rows={3}
              maxLength={REASON_MAX}
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
        ) : null}
        {mutation.error ? (
          <p role="alert" className="text-sm text-destructive">
            {mutation.error.message}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant={suspending ? "destructive" : "default"} disabled={mutation.pending}>
            {mutation.pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {suspending ? "Suspend seller" : "Unsuspend seller"}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={mutation.pending}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
