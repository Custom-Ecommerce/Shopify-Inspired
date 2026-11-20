"use client";

import { useCallback, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { changeDefaultRate, changeStoreRate } from "@/lib/api/client";
import { REASON_MAX, REASON_MIN, describeRateChange, parseRateInput } from "@/lib/commission-rates";
import { useAdminMutation } from "@/lib/hooks/use-admin-mutation";

export type RateTarget =
  | { kind: "store"; id: string; name: string; customRate: number | null; defaultRate: number }
  | { kind: "platform"; defaultRate: number };

/**
 * Sprint 4 EP-05.US02 (D-089): change a store's commission rate (or send it back to the platform default), or change the
 * platform default. Two steps: the new rate and a reason, then a confirmation that says what will change. The new rate applies
 * to orders delivered or paid after the change; nothing already in the ledger is rewritten.
 */
export function RateDialog({ target, onClose, onDone }: { target: RateTarget; onClose: () => void; onDone: () => void }) {
  const store = target.kind === "store" ? target : null;
  const [text, setText] = useState(store ? (store.customRate === null ? "" : String(store.customRate)) : String(target.defaultRate));
  const [useDefault, setUseDefault] = useState(false);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);

  const submit = useCallback(
    (input: { rate: number | null; reason: string }) => (store ? changeStoreRate(store.id, input) : changeDefaultRate({ rate: input.rate as number, reason: input.reason })),
    [store],
  );
  const mutation = useAdminMutation(submit);

  const parsed = useDefault ? null : parseRateInput(text);
  const from = store ? store.customRate : target.defaultRate;
  const subject = store ? store.name : "Platform default rate";

  function next(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let ok = true;
    if (!useDefault && parsed === null) {
      setRateError("Enter a rate from 0 to 100 with at most one decimal, for example 4 or 4.5.");
      ok = false;
    } else setRateError(null);
    const trimmed = reason.trim();
    if (trimmed.length < REASON_MIN || trimmed.length > REASON_MAX) {
      setReasonError("Give a reason of " + REASON_MIN + " to " + REASON_MAX + " characters.");
      ok = false;
    } else setReasonError(null);
    if (ok) setConfirming(true);
  }

  async function confirm() {
    const result = await mutation.run({ rate: useDefault ? null : parsed, reason: reason.trim() });
    if (result === null) return;
    toast.success(result.changed === false ? "Nothing changed: the rate was already that." : "Commission rate saved.");
    onDone();
  }

  return (
    <Dialog open onClose={onClose} title={store ? "Change the commission rate" : "Change the platform default rate"} description={subject} busy={mutation.pending}>
      {confirming ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-foreground">{describeRateChange(subject, from, useDefault ? null : parsed, target.defaultRate)}</p>
          {mutation.error ? (
            <p role="alert" className="text-sm text-destructive">
              {mutation.error.message}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void confirm()} disabled={mutation.pending}>
              {mutation.pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Confirm change
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={mutation.pending}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={next} className="flex flex-col gap-3" noValidate>
          {store ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={useDefault} onChange={(event) => setUseDefault(event.target.checked)} />
              Use the platform default ({target.defaultRate}%)
            </label>
          ) : null}
          {!useDefault ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rate-value">Rate (percent)</Label>
              <Input id="rate-value" inputMode="decimal" autoFocus value={text} aria-invalid={rateError !== null} onChange={(event) => setText(event.target.value)} />
              {rateError !== null ? (
                <p role="alert" className="text-sm text-destructive">
                  {rateError}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rate-reason">Reason (required)</Label>
            <Textarea id="rate-reason" rows={3} maxLength={REASON_MAX} value={reason} aria-invalid={reasonError !== null} onChange={(event) => setReason(event.target.value)} />
            {reasonError !== null ? (
              <p role="alert" className="text-sm text-destructive">
                {reasonError}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit">Review change</Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
