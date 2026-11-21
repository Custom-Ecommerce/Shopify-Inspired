"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PAYMENT_METHOD_OPTIONS,
  claimBody,
  claimProblems,
  currentPlanKey,
  formatDate,
  instructionLines,
  methodLabel,
  openStep,
  paymentStatusLabel,
  paymentStatusTone,
  planAction,
  planFeatureLines,
  priceText,
  readBilling,
  readInstructions,
  readPlans,
  readProblem,
  renewalDue,
  subscriptionLines,
  type BillingData,
  type ClaimForm,
  type ClaimProblems,
  type InstructionsData,
  type PlanData,
} from "@/lib/subscription-view";
import { formatRs } from "@/lib/format";

const JSON_HEADERS = { "Content-Type": "application/json" };

async function send(path: string, body: unknown): Promise<{ ok: true } | { ok: false; problem: ReturnType<typeof readProblem> }> {
  try {
    const res = await fetch(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
    if (res.ok) return { ok: true };
    return { ok: false, problem: readProblem(await res.json().catch(() => null), "Something went wrong. Please try again.") };
  } catch {
    return { ok: false, problem: readProblem(null, "Could not reach the server. Please try again.") };
  }
}

/**
 * Sprint 6 EP-14 (S6-B4, D-118): the plan, the plans, how to pay, the "I paid" form and the payment history. The plan belongs to the seller, so
 * nothing here needs a store. Everything that came from the server or the admin is shown as a React text node (escaped), never as markup. A
 * single column from 375 px up: cards stack, buttons are at least 44 px tall, and the payment history is a list of cards, not a table.
 */
export function SubscriptionSection() {
  const [billing, setBilling] = useState<BillingData | null>(null);
  const [plans, setPlans] = useState<PlanData[]>([]);
  const [instructions, setInstructions] = useState<InstructionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [exceeds, setExceeds] = useState<string[]>([]);
  const [form, setForm] = useState<ClaimForm>({ method: "", reference: "", proofUrl: "" });
  const [problems, setProblems] = useState<ClaimProblems>({});

  const load = useCallback(async () => {
    try {
      const [b, p, i] = await Promise.all([
        fetch("/api/dashboard/subscription", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
        fetch("/api/dashboard/plans", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
        fetch("/api/dashboard/subscription/instructions", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      ]);
      const read = readBilling(b);
      setBilling(read);
      setPlans(readPlans(p));
      setInstructions(readInstructions(i));
      setFailed(read === null);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const nameOf = useMemo(() => {
    const byKey = new Map(plans.map((plan) => [plan.key, plan.name]));
    return (key: string): string => byKey.get(key) ?? key.charAt(0).toUpperCase() + key.slice(1);
  }, [plans]);

  async function act(label: string, path: string, body: unknown, success: string): Promise<boolean> {
    setBusy(label);
    setExceeds([]);
    const result = await send(path, body);
    setBusy(null);
    if (result.ok) {
      toast.success(success);
      await load();
      return true;
    }
    setExceeds(result.problem.exceeds);
    toast.error(result.problem.message);
    return false;
  }

  async function submitClaim(paymentId: string) {
    const found = claimProblems(form);
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    const done = await act("claim", "/api/dashboard/subscription/payments/claim", claimBody(paymentId, form), "Thank you. We will check your payment soon.");
    if (done) setForm({ method: "", reference: "", proofUrl: "" });
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading your plan…</p>;
  if (failed || billing === null) {
    return (
      <SectionCard title="Your plan">
        <p className="text-sm text-muted-foreground">We could not load your plan just now.</p>
        <Button variant="outline" className="mt-3 min-h-11" onClick={() => void load()}>
          Try again
        </Button>
      </SectionCard>
    );
  }

  const now = new Date();
  const { subscription, open, payments } = billing;
  const currentKey = currentPlanKey(subscription, now);
  const current = plans.find((plan) => plan.key === currentKey) ?? null;
  const step = openStep(open);
  const renew = renewalDue(subscription, now);
  const lines = subscriptionLines(subscription, nameOf);

  return (
    <>
      <SectionCard title="Your plan" description={current === null ? undefined : current.name + " · " + priceText(current.priceRs)}>
        <div className="space-y-2" data-slot="subscription-lines">
          {lines.map((line) => (
            <p key={line} className="text-sm">
              {line}
            </p>
          ))}
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {subscription?.status === "active" && !subscription.cancelAtPeriodEnd && currentKey !== "free" ? (
            <Button variant="outline" className="min-h-11" disabled={busy !== null} onClick={() => void act("cancel", "/api/dashboard/subscription/cancel", { cancelAtPeriodEnd: true }, "Your plan will end at the end of the period.")}>
              {busy === "cancel" ? "Saving…" : "Cancel at the end of the period"}
            </Button>
          ) : null}
          {subscription?.status === "active" && subscription.cancelAtPeriodEnd ? (
            <Button variant="outline" className="min-h-11" disabled={busy !== null} onClick={() => void act("cancel", "/api/dashboard/subscription/cancel", { cancelAtPeriodEnd: false }, "Your plan will carry on.")}>
              {busy === "cancel" ? "Saving…" : "Keep my plan"}
            </Button>
          ) : null}
          {subscription?.pendingPlanKey ? (
            <Button variant="outline" className="min-h-11" disabled={busy !== null} onClick={() => void act("downgrade", "/api/dashboard/subscription/downgrade", { planKey: null }, "The change of plan was taken back.")}>
              {busy === "downgrade" ? "Saving…" : "Do not move to " + nameOf(subscription.pendingPlanKey)}
            </Button>
          ) : null}
        </div>
      </SectionCard>

      {step !== null && open !== null ? (
        <SectionCard title={"Pay for the " + nameOf(open.planKey) + " plan"} description={formatRs(open.amountRs) + " for one month"}>
          <div className="space-y-4" data-slot="payment-panel" data-step={step}>
            <div>
              <p className="text-sm font-medium">How to pay</p>
              {instructionLines(instructions?.paymentInstructions ?? null).length > 0 ? (
                <div className="mt-1 space-y-1 text-sm" data-slot="payment-instructions">
                  {instructionLines(instructions?.paymentInstructions ?? null).map((line, index) => (
                    <p key={index} className="break-words">
                      {line}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">Ask our team how to pay.</p>
              )}
              {instructions?.supportEmail || instructions?.supportPhone ? (
                <p className="mt-2 break-words text-xs text-muted-foreground">
                  Questions? {instructions.supportEmail ? instructions.supportEmail : ""}
                  {instructions.supportEmail && instructions.supportPhone ? " · " : ""}
                  {instructions.supportPhone ? instructions.supportPhone : ""}
                </p>
              ) : null}
              <p className="mt-2 text-sm">
                Amount to pay: <strong>{formatRs(open.amountRs)}</strong>
              </p>
            </div>

            {step === "pay" ? (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitClaim(open.id);
                }}
                noValidate
              >
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">How did you pay?</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {PAYMENT_METHOD_OPTIONS.map((option) => (
                      <label key={option.value} className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm">
                        <input
                          type="radio"
                          name="payment-method"
                          value={option.value}
                          checked={form.method === option.value}
                          onChange={() => setForm((f) => ({ ...f, method: option.value }))}
                          className="size-4"
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                  {problems.method ? (
                    <p className="text-sm text-destructive" role="alert">
                      {problems.method}
                    </p>
                  ) : null}
                </fieldset>

                <div className="space-y-1.5">
                  <Label htmlFor="payment-reference">Transfer reference</Label>
                  <Input
                    id="payment-reference"
                    value={form.reference}
                    maxLength={100}
                    autoComplete="off"
                    aria-invalid={problems.reference ? true : undefined}
                    onChange={(event) => setForm((f) => ({ ...f, reference: event.target.value }))}
                    className="min-h-11"
                    placeholder="The transaction id or reference number"
                  />
                  {problems.reference ? (
                    <p className="text-sm text-destructive" role="alert">
                      {problems.reference}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="payment-proof">Link to the receipt (optional)</Label>
                  <Input
                    id="payment-proof"
                    type="url"
                    inputMode="url"
                    value={form.proofUrl}
                    maxLength={300}
                    autoComplete="off"
                    aria-invalid={problems.proofUrl ? true : undefined}
                    onChange={(event) => setForm((f) => ({ ...f, proofUrl: event.target.value }))}
                    className="min-h-11"
                    placeholder="https://…"
                  />
                  {problems.proofUrl ? (
                    <p className="text-sm text-destructive" role="alert">
                      {problems.proofUrl}
                    </p>
                  ) : null}
                </div>

                <Button type="submit" variant="clay" className="min-h-11 w-full sm:w-auto" disabled={busy !== null}>
                  {busy === "claim" ? "Sending…" : "I have paid"}
                </Button>
              </form>
            ) : (
              <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm" data-slot="payment-waiting">
                <p className="font-medium">Thank you. We are checking your payment.</p>
                <p className="mt-1 text-muted-foreground">
                  You said you paid by {methodLabel(open.method)}
                  {open.reference ? ", reference " + open.reference : ""}. Your plan starts as soon as we confirm it.
                </p>
              </div>
            )}
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title="Plans" description="Pay once a month. Moving to a cheaper plan starts when your current period ends.">
        {exceeds.length > 0 ? (
          <div className="mb-4 rounded-lg border border-warning/60 bg-warning/10 p-3 text-sm" role="alert" data-slot="downgrade-exceeds">
            <p className="font-medium">You cannot move to that plan yet:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {exceeds.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="mt-1 text-muted-foreground">Remove the extra ones, then try again.</p>
          </div>
        ) : null}
        <ul className="flex flex-col gap-3" data-slot="plan-list">
          {plans.map((plan) => {
            const action = planAction(plan, current);
            const pending = subscription?.pendingPlanKey === plan.key;
            return (
              <li key={plan.key} className="rounded-xl border border-border p-4" data-plan={plan.key} data-action={action}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-heading text-base font-semibold">{plan.name}</h3>
                  <p className="text-sm font-medium">{priceText(plan.priceRs)}</p>
                </div>
                <ul className="mt-2 space-y-0.5 text-sm text-muted-foreground">
                  {planFeatureLines(plan).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <div className="mt-3">
                  {action === "current" ? (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Badge variant="secondary">Your plan</Badge>
                      {renew && plan.priceRs > 0 ? (
                        <Button className="min-h-11" disabled={busy !== null || open !== null} onClick={() => void act("request:" + plan.key, "/api/dashboard/subscription/payments", { planKey: plan.key }, "Payment details are ready below.")}>
                          {busy === "request:" + plan.key ? "Please wait…" : "Renew"}
                        </Button>
                      ) : null}
                    </div>
                  ) : action === "upgrade" ? (
                    <Button className="min-h-11 w-full sm:w-auto" disabled={busy !== null || (open !== null && open.planKey !== plan.key)} onClick={() => void act("request:" + plan.key, "/api/dashboard/subscription/payments", { planKey: plan.key }, "Payment details are ready below.")}>
                      {busy === "request:" + plan.key ? "Please wait…" : "Upgrade to " + plan.name}
                    </Button>
                  ) : pending ? (
                    <Badge variant="outline">Starts on {formatDate(subscription?.currentPeriodEnd)}</Badge>
                  ) : (
                    <Button variant="outline" className="min-h-11 w-full sm:w-auto" disabled={busy !== null || subscription === null} onClick={() => void act("downgrade:" + plan.key, "/api/dashboard/subscription/downgrade", { planKey: plan.key }, "Done. The change starts when your period ends.")}>
                      {busy === "downgrade:" + plan.key ? "Please wait…" : "Move to " + plan.name + " from " + (formatDate(subscription?.currentPeriodEnd) || "the period end")}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {open !== null ? <p className="mt-3 text-xs text-muted-foreground">Finish or wait for your open payment before asking for another plan.</p> : null}
      </SectionCard>

      <SectionCard title="Payment history">
        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payments yet.</p>
        ) : (
          <ul className="flex flex-col gap-3" data-slot="payment-history">
            {payments.map((payment) => (
              <li key={payment.id} className="rounded-xl border border-border p-3 text-sm" data-status={payment.status}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {nameOf(payment.planKey)} · {formatRs(payment.amountRs)}
                  </span>
                  <Badge variant={paymentStatusTone(payment.status)}>{paymentStatusLabel(payment.status)}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDate(payment.createdAt)}
                  {payment.method ? " · " + methodLabel(payment.method) : ""}
                  {payment.reference ? " · ref " + payment.reference : ""}
                </p>
                {payment.status === "confirmed" && payment.periodEnd ? <p className="mt-1 text-xs">Paid until {formatDate(payment.periodEnd)}.</p> : null}
                {payment.reason && (payment.status === "rejected" || payment.status === "void") ? <p className="mt-1 text-xs">Reason: {payment.reason}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </>
  );
}
