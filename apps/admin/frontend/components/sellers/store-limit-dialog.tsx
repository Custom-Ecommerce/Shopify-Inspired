"use client";

import { useCallback, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { getSellerStoreLimit, setSellerStoreLimit } from "@/lib/api/client";
import type { AdminSellerListItem } from "@/lib/contracts";
import { useAdminFetch } from "@/lib/hooks/use-admin-fetch";
import { useAdminMutation } from "@/lib/hooks/use-admin-mutation";
import {
  STORE_LIMIT_MAX,
  STORE_LIMIT_MIN,
  STORE_LIMIT_REASON_MAX,
  STORE_LIMIT_SOURCE_LABELS,
  describeEffectiveLimit,
  isUnchanged,
  limitWithoutOverride,
  overLimitNote,
  parseStoreLimitInput,
  storeLimitIssuesToErrors,
  storesLabel,
  toStoreLimitRequest,
  validateStoreLimitForm,
  type StoreLimitFormErrors,
  type StoreLimitView,
} from "@/lib/store-limit";

/**
 * Sprint 6 EP-12.US02.T03 (D-118): the Store limit dialog of the sellers page. It shows the seller's effective store limit and where it
 * comes from (override, plan, platform setting or environment), and lets an operator set an override or clear it, with a reason that goes to
 * the audit log. A seller who already has more stores than a lowered limit keeps them and is only blocked from adding more.
 */
export function StoreLimitDialog({ seller, onClose, onDone }: { seller: AdminSellerListItem; onClose: () => void; onDone: () => void }) {
  const { data, error, loading, refetch } = useAdminFetch((signal) => getSellerStoreLimit(seller.id, signal), [seller.id]);
  const view: StoreLimitView | null = data ? data.seller : null;

  return (
    <Dialog open onClose={onClose} title="Store limit" description={seller.name + " (" + seller.email + ")"}>
      {loading && view === null ? (
        <div aria-busy="true" aria-label="Loading the store limit">
          <Skeleton className="h-28" />
        </div>
      ) : null}
      {error !== null && view === null ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 text-sm text-destructive">
          <span>{error.message}</span>
          <Button variant="outline" size="sm" onClick={refetch}>
            Try again
          </Button>
        </div>
      ) : null}
      {view !== null ? <StoreLimitForm sellerId={seller.id} view={view} onClose={onClose} onDone={onDone} /> : null}
    </Dialog>
  );
}

function StoreLimitForm({ sellerId, view, onClose, onDone }: { sellerId: string; view: StoreLimitView; onClose: () => void; onDone: () => void }) {
  const [clear, setClear] = useState(false);
  const [value, setValue] = useState(String(view.storeLimitOverride ?? view.effectiveLimit));
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<StoreLimitFormErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const submit = useCallback((input: { storeLimitOverride: number | null; reason: string }) => setSellerStoreLimit(sellerId, input), [sellerId]);
  const mutation = useAdminMutation(submit);

  const serverFields: StoreLimitFormErrors = mutation.error ? storeLimitIssuesToErrors(mutation.error.issues) : {};
  const shown: StoreLimitFormErrors = { ...serverFields, ...errors };
  const generalError = mutation.error && Object.keys(serverFields).length === 0 ? mutation.error.message : null;
  const withoutOverride = limitWithoutOverride(view);
  const typed = parseStoreLimitInput(value);
  const wouldBe = clear ? withoutOverride.limit : typed;
  const warning = wouldBe === null ? null : overLimitNote(view.storesUsed, wouldBe);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    const values = { clear, value, reason };
    if (isUnchanged(values, view)) {
      setErrors({});
      setNotice(clear ? "This seller has no override to clear." : "That is already the override.");
      return;
    }
    const problems = validateStoreLimitForm(values);
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;
    const result = await mutation.run(toStoreLimitRequest(values));
    if (result === null) return;
    toast.success(clear ? "Store limit override cleared." : "Store limit set to " + storesLabel(result.seller.storeLimitOverride ?? 0) + ".");
    onDone();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate aria-label="Store limit">
      <p className="text-sm text-foreground" data-slot="effective-limit">
        {describeEffectiveLimit(view)}
      </p>
      <ul className="text-xs text-muted-foreground" aria-label="Where the limit can come from">
        {(Object.keys(STORE_LIMIT_SOURCE_LABELS) as Array<keyof typeof STORE_LIMIT_SOURCE_LABELS>).map((source) => (
          <li key={source} className={source === view.source ? "font-medium text-foreground" : undefined}>
            {STORE_LIMIT_SOURCE_LABELS[source]}
            {source === "override" ? ": " + (view.storeLimitOverride === null ? "none" : view.storeLimitOverride) : null}
            {source === "plan" ? ": " + (view.planLimit === null ? "could not be read" : view.planLimit) : null}
            {source === "setting" ? ": " + (view.platformMax === null ? "not set" : view.platformMax) : null}
            {source === "env" ? ": " + view.envMax : null}
            {source === view.source ? " (in use)" : null}
          </li>
        ))}
      </ul>

      {view.storeLimitOverride !== null ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={clear} onChange={(event) => setClear(event.target.checked)} />
          Remove the override (the limit becomes {storesLabel(withoutOverride.limit)} from {STORE_LIMIT_SOURCE_LABELS[withoutOverride.source].toLowerCase()})
        </label>
      ) : null}

      {!clear ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="store-limit-value">{view.storeLimitOverride === null ? "Set an override (stores)" : "New override (stores)"}</Label>
          <Input
            id="store-limit-value"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            maxLength={String(STORE_LIMIT_MAX).length}
            value={value}
            aria-invalid={shown.value !== undefined}
            aria-describedby={"store-limit-hint" + (shown.value !== undefined ? " store-limit-error" : "")}
            className="w-40 max-w-full tabular-nums aria-[invalid=true]:border-destructive"
            onChange={(event) => {
              setValue(event.target.value);
              setErrors((current) => ({ ...current, value: undefined }));
              setNotice(null);
              mutation.reset();
            }}
          />
          <p id="store-limit-hint" className="text-xs text-muted-foreground">
            A whole number from {STORE_LIMIT_MIN} to {STORE_LIMIT_MAX}. It wins over the plan and the platform setting.
          </p>
          {shown.value !== undefined ? (
            <p id="store-limit-error" role="alert" className="text-sm text-destructive">
              {shown.value}
            </p>
          ) : null}
        </div>
      ) : null}

      {warning !== null ? (
        <p role="status" className="text-sm text-muted-foreground" data-slot="over-limit-note">
          {warning}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="store-limit-reason">Reason (required)</Label>
        <Textarea
          id="store-limit-reason"
          rows={3}
          maxLength={STORE_LIMIT_REASON_MAX}
          value={reason}
          aria-invalid={shown.reason !== undefined}
          aria-describedby={shown.reason !== undefined ? "store-limit-reason-error" : undefined}
          onChange={(event) => {
            setReason(event.target.value);
            setErrors((current) => ({ ...current, reason: undefined }));
            mutation.reset();
          }}
        />
        {shown.reason !== undefined ? (
          <p id="store-limit-reason-error" role="alert" className="text-sm text-destructive">
            {shown.reason}
          </p>
        ) : null}
      </div>

      {notice !== null ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
      {generalError !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {generalError}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={mutation.pending}>
          {mutation.pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {clear ? "Remove override" : "Save store limit"}
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={mutation.pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
