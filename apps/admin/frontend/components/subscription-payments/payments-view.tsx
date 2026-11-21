"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { AdminPayment } from "@markaz/contracts";
import { TablePagination } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { listSubscriptionPayments, runPaymentAction } from "@/lib/api/client";
import { formatRelative } from "@/lib/format";
import { useAdminFetch } from "@/lib/hooks/use-admin-fetch";
import { useAdminMutation } from "@/lib/hooks/use-admin-mutation";
import {
  PAYMENT_ACTION_COPY,
  PAYMENT_BADGE_STATUS,
  PAYMENT_FILTER_LABELS,
  PAYMENT_REASON_MAX,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_VALUES,
  availablePaymentActions,
  confirmBody,
  confirmFacts,
  confirmProblems,
  decideBody,
  formatRs,
  methodLabel,
  parsePaymentListState,
  paymentStateToQuery,
  reasonProblem,
  safeProofHref,
  type PaymentAction,
  type PaymentListState,
} from "@/lib/subscription-payments";

/**
 * The manual subscription payments at /subscription-payments (Sprint 6 EP-14, S6-B4, D-118). The list opens on the payments waiting for a check.
 * An operator confirms a payment once the money is in the account (the seller's plan starts), rejects one with a reason, or voids one. Every text
 * from a seller or an operator is shown as plain text (React escapes it). One column of cards from 375 px up; the buttons are at least 44 px tall.
 */
export function PaymentsView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const state = useMemo(() => parsePaymentListState(searchParams), [searchParams]);
  const [intent, setIntent] = useState<{ action: PaymentAction; payment: AdminPayment } | null>(null);

  const go = useCallback(
    (next: PaymentListState) => {
      const query = paymentStateToQuery(next);
      router.replace(query === "" ? pathname : pathname + "?" + query);
    },
    [router, pathname],
  );

  const { data, error, loading, refetch } = useAdminFetch((signal) => listSubscriptionPayments(state, signal), [state.page, state.status]);

  useEffect(() => {
    if (data && data.totalPages > 0 && state.page > data.totalPages) go({ ...state, page: data.totalPages });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h2 className="font-heading mb-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Subscription payments</h2>
        <p className="text-sm text-muted-foreground">
          Sellers pay for their plan by bank, JazzCash or Easypaisa and tell us here. Check the money, then confirm. {data ? data.pendingCount + " to check." : ""}
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row" role="search">
        <Select aria-label="Filter by status" className="sm:w-64" value={state.status} onChange={(event) => go({ status: event.target.value as PaymentListState["status"], page: 1 })}>
          {(["claimed", "requested", "confirmed", "rejected", "void", "all"] as const).map((value) => (
            <option key={value} value={value}>
              {PAYMENT_FILTER_LABELS[value]}
            </option>
          ))}
        </Select>
      </div>

      {error !== null && (data?.docs.length ?? 0) === 0 ? (
        <Card role="alert" className="flex flex-col items-center gap-3 border-destructive/20 bg-destructive/8 px-6 py-10 text-center">
          <p className="max-w-sm text-sm font-medium text-foreground">{error.message}</p>
          <Button variant="outline" size="sm" onClick={refetch}>
            Try again
          </Button>
        </Card>
      ) : loading && !data ? (
        <div className="flex flex-col gap-3" aria-busy>
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : (data?.docs.length ?? 0) === 0 ? (
        <Card className="bg-muted/30 px-4 py-12 text-center">
          <p className="font-heading text-lg font-semibold text-foreground">{state.status === "claimed" ? "Nothing to check" : "No payments here"}</p>
          <p className="mt-1 text-sm text-muted-foreground">{state.status === "claimed" ? "Payments sellers say they made appear here." : "Try a different filter."}</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Subscription payments" data-slot="payment-list">
          {data?.docs.map((payment) => (
            <PaymentCard key={payment.id} payment={payment} onAction={(action) => setIntent({ action, payment })} />
          ))}
        </ul>
      )}

      {data ? <TablePagination page={data.page} totalPages={data.totalPages} totalDocs={data.totalDocs} noun="payment" disabled={loading} onPage={(page) => go({ ...state, page })} /> : null}

      {intent !== null ? (
        <PaymentDialog
          key={intent.action + intent.payment.id}
          action={intent.action}
          payment={intent.payment}
          onClose={() => setIntent(null)}
          onDone={() => {
            setIntent(null);
            refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function PaymentCard({ payment, onAction }: { payment: AdminPayment; onAction: (action: PaymentAction) => void }) {
  const actions = availablePaymentActions(payment);
  const proof = safeProofHref(payment.proofUrl);
  return (
    <li className="rounded-xl border border-border bg-card p-4" data-status={payment.status}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold">{payment.seller.name === "" ? payment.seller.email : payment.seller.name}</p>
          <p className="break-all text-xs text-muted-foreground">{payment.seller.email}</p>
        </div>
        <StatusBadge status={PAYMENT_BADGE_STATUS[payment.status]} label={PAYMENT_STATUS_LABELS[payment.status]} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Plan</dt>
          <dd className="break-words">{payment.planName}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Amount</dt>
          <dd className="font-medium">{formatRs(payment.amountRs)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Paid by</dt>
          <dd>{methodLabel(payment.method)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Asked</dt>
          <dd>{formatRelative(payment.createdAt)}</dd>
        </div>
        <div className="col-span-2 sm:col-span-4">
          <dt className="text-xs text-muted-foreground">Reference</dt>
          <dd className="break-all">{payment.reference ?? "Not stated"}</dd>
        </div>
        {payment.proofUrl !== null ? (
          <div className="col-span-2 sm:col-span-4">
            <dt className="text-xs text-muted-foreground">Receipt</dt>
            <dd className="break-all">
              {proof !== null ? (
                <a href={proof} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-4 hover:underline">
                  {payment.proofUrl}
                </a>
              ) : (
                payment.proofUrl
              )}
            </dd>
          </div>
        ) : null}
        {payment.reason !== null && payment.status !== "claimed" && payment.status !== "requested" ? (
          <div className="col-span-2 sm:col-span-4">
            <dt className="text-xs text-muted-foreground">Reason</dt>
            <dd className="break-words">{payment.reason}</dd>
          </div>
        ) : null}
      </dl>
      {actions.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          {actions.map((action) => (
            <Button key={action} variant={action === "confirm" ? "default" : "outline"} className="min-h-11 sm:min-w-28" onClick={() => onAction(action)}>
              {PAYMENT_ACTION_COPY[action].button}
            </Button>
          ))}
        </div>
      ) : null}
    </li>
  );
}

/** One action on one payment. Confirm repeats what the operator is confirming (amount, method, reference) and asks for the tick and a reason. */
function PaymentDialog({ action, payment, onClose, onDone }: { action: PaymentAction; payment: AdminPayment; onClose: () => void; onDone: () => void }) {
  const copy = PAYMENT_ACTION_COPY[action];
  const [reason, setReason] = useState("");
  const [checked, setChecked] = useState(false);
  const [problems, setProblems] = useState<{ checked?: string; reason?: string }>({});
  const submit = useCallback((input: { amountRs?: number; reason: string }) => runPaymentAction(action, payment.id, input), [action, payment.id]);
  const mutation = useAdminMutation(submit);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = action === "confirm" ? confirmProblems({ checked, reason }) : ((): { reason?: string } => {
      const problem = reasonProblem(action, reason);
      return problem === null ? {} : { reason: problem };
    })();
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    const result = await mutation.run(action === "confirm" ? confirmBody(payment, reason) : decideBody(reason));
    if (result === null) return;
    toast.success(copy.done);
    onDone();
  }

  return (
    <Dialog open onClose={onClose} title={copy.title} description={payment.planName + " · " + formatRs(payment.amountRs)} busy={mutation.pending}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        <p className="text-sm text-muted-foreground">{copy.hint}</p>
        {action === "confirm" ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-border bg-muted/30 p-3 text-sm" data-slot="confirm-facts">
            {confirmFacts(payment).map((fact) => (
              <div key={fact.label} className="contents">
                <dt className="text-muted-foreground">{fact.label}</dt>
                <dd className="break-words font-medium">{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {action === "confirm" ? (
          <div className="flex flex-col gap-1">
            <label className="flex min-h-11 items-start gap-3 text-sm">
              <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
              <span>I have seen {formatRs(payment.amountRs)} in our account for this payment.</span>
            </label>
            {problems.checked ? (
              <p role="alert" className="text-sm text-destructive">
                {problems.checked}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="payment-reason">{action === "confirm" ? "Note for the record (required)" : "Reason (required)"}</Label>
          <Textarea
            id="payment-reason"
            autoFocus={action !== "confirm"}
            required
            rows={3}
            maxLength={PAYMENT_REASON_MAX}
            value={reason}
            aria-invalid={problems.reason !== undefined}
            onChange={(event) => setReason(event.target.value)}
          />
          {problems.reason ? (
            <p role="alert" className="text-sm text-destructive">
              {problems.reason}
            </p>
          ) : null}
        </div>
        {mutation.error ? (
          <p role="alert" className="text-sm text-destructive">
            {mutation.error.message}
          </p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button type="submit" className="min-h-11" variant={action === "confirm" ? "default" : "destructive"} disabled={mutation.pending}>
            {mutation.pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {copy.confirm}
          </Button>
          <Button variant="ghost" className="min-h-11" onClick={onClose} disabled={mutation.pending}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
