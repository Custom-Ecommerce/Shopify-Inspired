"use client";

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { changeStoreStatus } from "@/lib/api/client";
import { GOVERNANCE_NOTE_MAX, GOVERNANCE_REASON_MAX, GOVERNANCE_REASON_MIN, type AdminStoreDetail } from "@/lib/contracts";
import { useAdminMutation } from "@/lib/hooks/use-admin-mutation";
import { statusLabel } from "@/lib/status";
import { ACTION_COPY, availableActions, validateReason, type GovernanceAction } from "@/lib/stores";

export function GovernancePanel({ store, onChanged }: { store: AdminStoreDetail; onChanged: () => void }) {
  const actions = availableActions(store.status);
  const [intent, setIntent] = useState<GovernanceAction | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const mutation = useAdminMutation((input: Parameters<typeof changeStoreStatus>[1]) => changeStoreStatus(store.id, input));

  function close() {
    setIntent(null);
    setReason("");
    setNote("");
    setFieldError(null);
    mutation.reset();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (intent === null) return;
    const problem = validateReason(reason, GOVERNANCE_REASON_MIN, GOVERNANCE_REASON_MAX);
    if (problem !== null) {
      setFieldError(problem);
      return;
    }
    setFieldError(null);
    const copy = ACTION_COPY[intent];
    const result = await mutation.run({ status: copy.target, reason: reason.trim(), ...(note.trim() !== "" ? { note: note.trim() } : {}) });
    if (result === null) {
      onChanged();
      return;
    }
    toast.success(copy.done, { description: result.queued ? "Queued for the seller." : undefined });
    close();
    onChanged();
  }

  const copy = intent === null ? null : ACTION_COPY[intent];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Governance</CardTitle>
        <CardDescription>Change whether this store can trade. Every change is recorded with your name and reason.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {actions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No governance actions are available for a {statusLabel(store.status).toLowerCase()} store.</p>
        ) : intent === null ? (
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <Button key={action} variant={action === "suspend" ? "destructive" : "default"} onClick={() => setIntent(action)}>
                {ACTION_COPY[action].button}
              </Button>
            ))}
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate aria-label={copy?.title}>
            <p className="text-sm font-medium">{copy?.title}</p>
            <p className="text-sm text-muted-foreground">{copy?.hint}</p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="governance-reason">Reason (required)</Label>
              <Textarea
                id="governance-reason"
                autoFocus
                required
                rows={3}
                maxLength={GOVERNANCE_REASON_MAX}
                value={reason}
                aria-invalid={fieldError !== null}
                aria-describedby={fieldError !== null ? "governance-reason-error" : undefined}
                onChange={(event) => setReason(event.target.value)}
              />
              {fieldError !== null ? (
                <p id="governance-reason-error" role="alert" className="text-sm text-destructive">
                  {fieldError}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="governance-note">Internal note (optional)</Label>
              <Textarea id="governance-note" rows={2} maxLength={GOVERNANCE_NOTE_MAX} value={note} onChange={(event) => setNote(event.target.value)} />
            </div>
            {mutation.error ? (
              <p role="alert" className="text-sm text-destructive">
                {mutation.error.message}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant={intent === "suspend" ? "destructive" : "default"} disabled={mutation.pending}>
                {mutation.pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {copy?.confirm}
              </Button>
              <Button variant="ghost" onClick={close} disabled={mutation.pending}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
