"use client";

import { useCallback, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { archivePlan } from "@/lib/api/client";
import type { AdminSubscriptionPlan } from "@/lib/contracts";
import { useAdminMutation } from "@/lib/hooks/use-admin-mutation";
import { PLAN_REASON_MAX, archiveReasonProblem, toArchiveRequest } from "@/lib/plans";

/**
 * Sprint 6 EP-14.US01 (D-118): archive a plan, with a reason. Archiving takes the plan off sale; it is never deleted, and sellers already
 * on it keep it. The write is conditional on the revision that was loaded.
 */
export function PlanArchiveDialog({ plan, onClose, onDone }: { plan: AdminSubscriptionPlan; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const submit = useCallback((input: { revision: number; reason: string }) => archivePlan(plan.id, input), [plan.id]);
  const mutation = useAdminMutation(submit);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = archiveReasonProblem(reason);
    setFieldError(problem);
    if (problem !== null) return;
    const result = await mutation.run(toArchiveRequest(plan, reason));
    if (result === null) return;
    toast.success("Plan archived.");
    onDone();
  }

  return (
    <Dialog open onClose={onClose} title="Archive this plan?" description={plan.name + (plan.key ? " (" + plan.key + ")" : "")} busy={mutation.pending}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        <p className="text-sm text-muted-foreground">The plan is taken off sale. It is not deleted, and sellers already on it keep it.</p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="plan-archive-reason">Reason (required)</Label>
          <Textarea
            id="plan-archive-reason"
            autoFocus
            rows={3}
            maxLength={PLAN_REASON_MAX}
            value={reason}
            aria-invalid={fieldError !== null}
            onChange={(event) => {
              setReason(event.target.value);
              setFieldError(null);
              mutation.reset();
            }}
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
            Archive plan
          </Button>
          {mutation.error && mutation.error.status === 409 ? (
            <Button variant="outline" onClick={onDone} disabled={mutation.pending}>
              Reload plans
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={mutation.pending}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
