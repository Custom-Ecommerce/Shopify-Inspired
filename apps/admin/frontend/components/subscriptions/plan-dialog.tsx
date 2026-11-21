"use client";

import { useCallback, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createPlan, updatePlan } from "@/lib/api/client";
import type { AdminSubscriptionPlan } from "@/lib/contracts";
import { useAdminMutation } from "@/lib/hooks/use-admin-mutation";
import {
  LIMIT_FIELDS,
  LIMIT_LABELS,
  PLAN_FEATURES_MAX,
  PLAN_FEATURE_MAX,
  PLAN_NAME_MAX,
  PLAN_REASON_MAX,
  changedPlanFields,
  conflictField,
  emptyPlanForm,
  formFromPlan,
  planIssuesToErrors,
  toCreateRequest,
  toUpdateRequest,
  validatePlanForm,
  type PlanFormErrors,
  type PlanFormField,
  type PlanFormValues,
} from "@/lib/plans";

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

/**
 * Sprint 6 EP-14.US01 (D-118): create a plan, or edit one. Plans are data: the price is WHOLE RUPEES and a limit left empty is unlimited. A
 * reason is always required and goes to the audit log. The key is chosen once and never changes. An edit is conditional on the revision that
 * was loaded: if someone else changed the plan, the console says so and the plan is reloaded, nothing is overwritten.
 */
export function PlanDialog({ plan, onClose, onDone }: { plan: AdminSubscriptionPlan | null; onClose: () => void; onDone: () => void }) {
  const mode = plan === null ? "create" : "edit";
  const [values, setValues] = useState<PlanFormValues>(plan === null ? emptyPlanForm() : formFromPlan(plan));
  const [errors, setErrors] = useState<PlanFormErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const submit = useCallback(
    (input: unknown) => (plan === null ? createPlan(input) : updatePlan(plan.id, input)),
    [plan],
  );
  const mutation = useAdminMutation(submit);

  const serverError = mutation.error;
  const serverFields: PlanFormErrors = serverError ? planIssuesToErrors(serverError.issues) : {};
  const conflict = serverError ? conflictField(serverError.status, serverError.message) : null;
  if (conflict !== null && serverFields[conflict] === undefined) serverFields[conflict] = serverError!.message;
  const shown: PlanFormErrors = { ...serverFields, ...errors };
  const generalError = serverError && Object.keys(serverFields).length === 0 ? serverError.message : null;
  const stale = serverError !== null && serverError.status === 409 && conflict === null;

  function change<K extends PlanFormField>(field: K, value: PlanFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setNotice(null);
    mutation.reset();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    const problems = validatePlanForm(values, mode);
    if (plan !== null && changedPlanFields(values, plan).length === 0 && Object.keys(problems).every((field) => field === "reason")) {
      setErrors({});
      setNotice("Nothing has changed.");
      return;
    }
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;
    const result = await mutation.run(plan === null ? toCreateRequest(values) : toUpdateRequest(values, plan));
    if (result === null) return;
    toast.success(plan === null ? "Plan created." : "Plan saved.");
    onDone();
  }

  const describedBy = (field: PlanFormField, hint = true) => (hint ? "plan-" + field + "-hint" : "") + (shown[field] !== undefined ? " plan-" + field + "-error" : "");

  return (
    <Dialog open onClose={onClose} title={plan === null ? "New plan" : "Edit plan"} description={plan === null ? "Plans are data: set the price and the limits." : plan.name} busy={mutation.pending}>
      <form onSubmit={onSubmit} noValidate aria-label={plan === null ? "New plan" : "Edit plan"} className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="plan-key">Key</Label>
            <Input
              id="plan-key"
              autoComplete="off"
              autoFocus={plan === null}
              maxLength={30}
              disabled={plan !== null}
              value={values.key}
              aria-invalid={shown.key !== undefined}
              aria-describedby={describedBy("key")}
              className="aria-[invalid=true]:border-destructive"
              onChange={(event) => change("key", event.target.value)}
            />
            <p id="plan-key-hint" className="text-xs text-muted-foreground">
              {plan === null ? "Lower case letters, digits and hyphens. It cannot be changed later." : "The key cannot be changed."}
            </p>
            <FieldError id="plan-key-error" message={shown.key} />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="plan-name">Name</Label>
            <Input
              id="plan-name"
              autoComplete="off"
              autoFocus={plan !== null}
              maxLength={PLAN_NAME_MAX}
              value={values.name}
              aria-invalid={shown.name !== undefined}
              aria-describedby={describedBy("name", false)}
              className="aria-[invalid=true]:border-destructive"
              onChange={(event) => change("name", event.target.value)}
            />
            <FieldError id="plan-name-error" message={shown.name} />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="plan-price">Price per month (Rs)</Label>
            <Input
              id="plan-price"
              inputMode="numeric"
              autoComplete="off"
              maxLength={11}
              value={values.priceRs}
              aria-invalid={shown.priceRs !== undefined}
              aria-describedby={describedBy("priceRs")}
              className="w-40 max-w-full tabular-nums aria-[invalid=true]:border-destructive"
              onChange={(event) => change("priceRs", event.target.value)}
            />
            <p id="plan-priceRs-hint" className="text-xs text-muted-foreground">
              Whole rupees. 0 is free.
            </p>
            <FieldError id="plan-priceRs-error" message={shown.priceRs} />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="plan-sort">Sort order</Label>
            <Input
              id="plan-sort"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={values.sortOrder}
              aria-invalid={shown.sortOrder !== undefined}
              aria-describedby={describedBy("sortOrder", false)}
              className="w-40 max-w-full tabular-nums aria-[invalid=true]:border-destructive"
              onChange={(event) => change("sortOrder", event.target.value)}
            />
            <FieldError id="plan-sortOrder-error" message={shown.sortOrder} />
          </div>
        </div>

        <fieldset className="flex min-w-0 flex-col gap-3 rounded-xl border border-border p-3">
          <legend className="px-1 text-sm font-medium">Limits</legend>
          <p className="text-xs text-muted-foreground">Leave a limit empty for unlimited.</p>
          <div className="grid grid-cols-2 gap-3">
            {LIMIT_FIELDS.map((field) => (
              <div key={field} className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor={"plan-" + field}>{LIMIT_LABELS[field]}</Label>
                <Input
                  id={"plan-" + field}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="Unlimited"
                  maxLength={7}
                  value={values[field]}
                  aria-invalid={shown[field] !== undefined}
                  aria-describedby={describedBy(field, false)}
                  className="tabular-nums aria-[invalid=true]:border-destructive"
                  onChange={(event) => change(field, event.target.value)}
                />
                <FieldError id={"plan-" + field + "-error"} message={shown[field]} />
              </div>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={values.customDomain} onChange={(event) => change("customDomain", event.target.checked)} />
            Custom domain
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={values.premiumThemes} onChange={(event) => change("premiumThemes", event.target.checked)} />
            Premium themes
          </label>
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="plan-features">Features (one per line, optional)</Label>
          <Textarea
            id="plan-features"
            rows={4}
            value={values.features}
            aria-invalid={shown.features !== undefined}
            aria-describedby={describedBy("features")}
            onChange={(event) => change("features", event.target.value)}
          />
          <p id="plan-features-hint" className="text-xs text-muted-foreground">
            At most {PLAN_FEATURES_MAX} lines of {PLAN_FEATURE_MAX} characters. Plain text.
          </p>
          <FieldError id="plan-features-error" message={shown.features} />
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="plan-stripe">Stripe price id (optional)</Label>
          <Input
            id="plan-stripe"
            autoComplete="off"
            maxLength={110}
            value={values.stripePriceId}
            aria-invalid={shown.stripePriceId !== undefined}
            aria-describedby={describedBy("stripePriceId")}
            className="font-mono text-xs aria-[invalid=true]:border-destructive"
            onChange={(event) => change("stripePriceId", event.target.value)}
          />
          <p id="plan-stripePriceId-hint" className="text-xs text-muted-foreground">
            Only for a plan paid through Stripe, which is off. Subscription payment is manual first.
          </p>
          <FieldError id="plan-stripePriceId-error" message={shown.stripePriceId} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="plan-reason">Reason (required)</Label>
          <Textarea
            id="plan-reason"
            rows={2}
            maxLength={PLAN_REASON_MAX}
            value={values.reason}
            aria-invalid={shown.reason !== undefined}
            aria-describedby={describedBy("reason", false)}
            onChange={(event) => change("reason", event.target.value)}
          />
          <FieldError id="plan-reason-error" message={shown.reason} />
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
            {plan === null ? "Create plan" : "Save plan"}
          </Button>
          {stale ? (
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
