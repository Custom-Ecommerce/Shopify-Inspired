"use client";

import { useCallback, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { runModerationAction } from "@/lib/api/client";
import { MODERATION_REASON_MAX, MODERATION_REASON_MIN, type ModerationProduct } from "@/lib/contracts";
import { useAdminMutation } from "@/lib/hooks/use-admin-mutation";
import { MODERATION_COPY, type ModerationAction } from "@/lib/products";

/** One action on one product: what it does, a reason where one is required, and an explicit confirm. */
export function ModerationDialog({
  action,
  product,
  onClose,
  onDone,
}: {
  action: ModerationAction;
  product: ModerationProduct;
  onClose: () => void;
  onDone: () => void;
}) {
  const copy = MODERATION_COPY[action];
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const submit = useCallback((input: { reason: string }) => runModerationAction(action, product.productId, input.reason), [action, product.productId]);
  const mutation = useAdminMutation(submit);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = reason.trim();
    if (copy.needsReason && trimmed.length < MODERATION_REASON_MIN) {
      setFieldError("Give a reason of at least " + MODERATION_REASON_MIN + " characters.");
      return;
    }
    setFieldError(null);
    const result = await mutation.run({ reason: trimmed });
    if (result === null) return;
    toast.success(copy.done);
    onDone();
  }

  return (
    <Dialog open onClose={onClose} title={copy.title} description={product.title + " in " + (product.storeName ?? "an unnamed store")} busy={mutation.pending}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        <p className="text-sm text-muted-foreground">{copy.hint}</p>
        {copy.needsReason ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="moderation-reason">Reason (required)</Label>
            <Textarea
              id="moderation-reason"
              autoFocus
              required
              rows={3}
              maxLength={MODERATION_REASON_MAX}
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
          <Button type="submit" variant={copy.danger ? "destructive" : "default"} disabled={mutation.pending}>
            {mutation.pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {copy.confirm}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={mutation.pending}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
