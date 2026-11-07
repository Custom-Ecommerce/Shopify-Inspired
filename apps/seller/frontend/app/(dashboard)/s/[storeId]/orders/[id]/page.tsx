"use client";

import type { DashboardOrderDetail, OrderCancelResponse, OrderStockRestore } from "@markaz/contracts";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { storeHref } from "@/lib/store-routes";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/dashboard/shared/EmptyState";
import { ErrorState } from "@/components/dashboard/shared/ErrorState";
import {
  ORDER_STATUS_LABEL,
  OrderStatusBadge,
  PAYMENT_METHOD_LABEL,
  PaymentStatusBadge,
} from "@/components/dashboard/shared/StatusBadge";

// EP-02 OB-1b: the order detail, read only. Data comes from GET /api/dashboard/orders/:id (proxy to the seller backend's
// GET /api/orders/:id), in the DashboardOrderDetail shape.

type LoadState =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "error" }
  | { kind: "ready"; order: DashboardOrderDetail };

/** One button per allowed next status (OB-2). The flow itself comes from the API's allowedNext, never from here. */
const ACTION_LABEL: Record<string, string> = {
  confirmed: "Confirm order",
  processing: "Start processing",
  dispatched: "Mark as dispatched",
  delivered: "Mark as delivered",
};

/** Moves that ask first. OB-4 replaces the dispatch question with the courier form. */
const CONFIRM_COPY: Record<string, { title: string; description: string }> = {
  dispatched: {
    title: "Mark this order as dispatched?",
    description: "Do this once the parcel has left with the courier. The order cannot go back to processing.",
  },
  delivered: {
    title: "Mark this order as delivered?",
    description: "Do this once the customer has received the parcel. This is the last step of the order.",
  },
};

interface ActionError {
  message: string;
  /** The move to try again, for errors that are worth retrying as they are. */
  retry: string | null;
}

const money = (amount: number): string => `PKR ${amount.toLocaleString()}`;

const dateTime = (iso: string): string =>
  new Date(iso).toLocaleString("en-PK", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Karachi",
  });

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right">{children}</span>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading order">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-5 w-64" />
      <Skeleton className="h-40 w-full rounded-2xl" />
      <Skeleton className="h-32 w-full rounded-2xl" />
    </div>
  );
}

// EP-02 OB-3: cancel. The suggested reasons match ORDER_CANCEL_REASON_OPTIONS in @markaz/contracts (the frontend imports
// contracts as types only); "Other" asks for the seller's own words. The request takes one reason string, 3 to 200 chars.
const CANCEL_REASONS = ["Customer asked to cancel", "Customer unreachable", "Out of stock", "Wrong or fake order"] as const;
const OTHER_REASON = "Other";
const CANCEL_REASON_MIN = 3;
const CANCEL_REASON_MAX = 200;

const SKIP_WORDS: Record<string, string> = {
  product_deleted: "product deleted",
  variant_deleted: "variant deleted",
};

const itemName = (item: { productTitle: string; variantTitle: string }): string =>
  item.variantTitle && item.variantTitle !== "Default" ? `${item.productTitle} (${item.variantTitle})` : item.productTitle;

/** A short plain-words notice of what happened to the stock after a cancel. */
function stockNoticeText(result: OrderStockRestore): string {
  const parts = ["Order cancelled."];
  if (result.restored.length > 0) {
    parts.push("Back in stock: " + result.restored.map((line) => `${line.qty} × ${line.name}`).join(", ") + ".");
  }
  const notReturned = result.skipped.filter((line) => SKIP_WORDS[line.why]).map((line) => `${line.name} (${SKIP_WORDS[line.why]})`);
  if (notReturned.length > 0) parts.push("Not returned: " + notReturned.join(", ") + ".");
  if (result.failed.length > 0) {
    parts.push("Could not return: " + result.failed.map((line) => line.name).join(", ") + ". Adjust it on the Inventory page.");
  }
  return parts.join(" ");
}

/**
 * The "Cancel order" button and its dialog. The dialog lists what will go back to stock: lines whose stock was taken at
 * placement (stockDeducted true), and for older orders (no flag) the lines that may go back if they track stock. Lines that
 * took nothing are not listed.
 */
function CancelOrderDialog({
  order,
  disabled,
  onCancelled,
  onConflict,
}: {
  order: DashboardOrderDetail;
  disabled: boolean;
  onCancelled: (result: OrderStockRestore) => Promise<void>;
  onConflict: () => Promise<void>;
}) {
  const storeFetch = useStoreFetch();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<string>(CANCEL_REASONS[0]);
  const [otherText, setOtherText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reason = choice === OTHER_REASON ? otherText.trim() : choice;
  const reasonValid = reason.length >= CANCEL_REASON_MIN && reason.length <= CANCEL_REASON_MAX;
  const returning = order.items.filter((item) => item.stockDeducted === true);
  const maybeReturning = order.items.filter((item) => item.stockDeducted === null);

  function openDialog(): void {
    setChoice(CANCEL_REASONS[0]);
    setOtherText("");
    setError(null);
    setOpen(true);
  }

  async function submit(): Promise<void> {
    if (!reasonValid) {
      setError(`Write a reason of ${CANCEL_REASON_MIN} to ${CANCEL_REASON_MAX} characters.`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await storeFetch(`/api/dashboard/orders/${order.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as OrderCancelResponse | null;
        setOpen(false);
        await onCancelled(data?.stockRestore ?? { restored: [], skipped: [], failed: [] });
        return;
      }
      if (res.status === 409 || res.status === 422) {
        setOpen(false);
        await onConflict();
        return;
      }
      setError("Could not cancel the order. Check your connection and try again.");
    } catch {
      setError("Could not cancel the order. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => (!next && !submitting ? setOpen(false) : undefined)}>
      <Button variant="destructive" className="h-11 w-full sm:w-auto" disabled={disabled || submitting} onClick={openDialog}>
        Cancel order
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel order {order.orderId}?</AlertDialogTitle>
          <AlertDialogDescription>A cancelled order cannot be reopened.</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex min-w-0 flex-col gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="font-medium">Reason</span>
            <select
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              disabled={submitting}
              className="h-11 w-full rounded-md border border-input bg-transparent px-2 text-sm sm:h-9"
            >
              {[...CANCEL_REASONS, OTHER_REASON].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          {choice === OTHER_REASON ? (
            <label className="flex flex-col gap-1">
              <span className="font-medium">Your reason</span>
              <Textarea
                value={otherText}
                onChange={(event) => setOtherText(event.target.value)}
                maxLength={CANCEL_REASON_MAX}
                disabled={submitting}
                required
                placeholder="Why is this order cancelled?"
              />
            </label>
          ) : null}

          {returning.length > 0 || maybeReturning.length > 0 ? (
            <div className="flex flex-col gap-1">
              <span className="font-medium">Stock</span>
              <ul className="flex flex-col gap-0.5 text-muted-foreground">
                {returning.map((item, i) => (
                  <li key={"r" + i} className="break-words">
                    {item.quantity} × {itemName(item)} will go back to stock
                  </li>
                ))}
                {maybeReturning.map((item, i) => (
                  <li key={"m" + i} className="break-words">
                    {item.quantity} × {itemName(item)} will go back to stock if it tracks quantity
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel className="h-11 w-full sm:h-9 sm:w-auto" disabled={submitting}>
            Keep order
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            className="h-11 w-full sm:h-9 sm:w-auto"
            disabled={submitting || !reasonValid}
            onClick={() => void submit()}
          >
            {submitting ? "Cancelling…" : "Cancel order"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function OrderDetailPage() {
  const storeFetch = useStoreFetch();
  const params = useParams<{ storeId: string; id: string }>();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [running, setRunning] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [actionError, setActionError] = useState<ActionError | null>(null);
  const [stockNotice, setStockNotice] = useState<string | null>(null);

  /** Reads the order. A quiet refresh (after an action) keeps the page on screen instead of showing the skeleton. */
  const fetchOrder = useCallback(
    async (quiet: boolean): Promise<void> => {
      if (!quiet) setState({ kind: "loading" });
      try {
        const res = await storeFetch(`/api/dashboard/orders/${params.id}`);
        if (res.status === 404) return setState({ kind: "not_found" });
        const data = (await res.json().catch(() => null)) as DashboardOrderDetail | null;
        if (!res.ok || !data?.id) {
          if (!quiet) setState({ kind: "error" });
          return;
        }
        setState({ kind: "ready", order: data });
      } catch {
        if (!quiet) setState({ kind: "error" });
      }
    },
    [params.id, storeFetch],
  );

  const load = useCallback(() => {
    setActionError(null);
    setStockNotice(null);
    void fetchOrder(false);
  }, [fetchOrder]);

  /** After a cancel: show what happened to the stock, then read the order again (quietly). */
  async function handleCancelled(result: OrderStockRestore): Promise<void> {
    setActionError(null);
    setStockNotice(stockNoticeText(result));
    await fetchOrder(true);
  }

  /** 409 or 422 from cancel: the order moved on (or was already cancelled) elsewhere. */
  async function handleCancelConflict(): Promise<void> {
    setStockNotice(null);
    setActionError({
      message: "This order was changed by someone else or in another tab, so it was not cancelled. It has been refreshed; check its status.",
      retry: null,
    });
    await fetchOrder(true);
  }

  useEffect(load, [load]);

  /** Sends one move, then always reads the order again from the server (no optimistic update). */
  async function runTransition(target: string): Promise<void> {
    setRunning(target);
    setActionError(null);
    try {
      const res = await storeFetch(`/api/dashboard/orders/${params.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: target }),
      });
      if (res.status === 409 || res.status === 422) {
        setActionError({
          message: "This order was changed by someone else or in another tab. It has been refreshed, so check its status and try again.",
          retry: null,
        });
      } else if (!res.ok) {
        setActionError({ message: "Could not save this change. Check your connection and try again.", retry: target });
      }
      await fetchOrder(true);
    } catch {
      setActionError({ message: "Could not save this change. Check your connection and try again.", retry: target });
    } finally {
      setRunning(null);
      setConfirming(null);
    }
  }

  function startTransition(target: string): void {
    if (CONFIRM_COPY[target]) setConfirming(target);
    else void runTransition(target);
  }

  const backLink = (
    <Link href={storeHref(params.storeId, "/orders")} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
      ← All orders
    </Link>
  );

  if (state.kind === "loading") {
    return (
      <div className="flex max-w-3xl flex-col gap-4 p-4 sm:p-8">
        {backLink}
        <DetailSkeleton />
      </div>
    );
  }
  if (state.kind === "not_found") {
    return (
      <div className="flex max-w-3xl flex-col gap-4 p-4 sm:p-8">
        {backLink}
        <EmptyState title="Order not found" description="This order does not exist in this store." />
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="flex max-w-3xl flex-col gap-4 p-4 sm:p-8">
        {backLink}
        <ErrorState message="Could not load this order." onRetry={load} />
      </div>
    );
  }

  const { order } = state;

  return (
    <div className="flex min-w-0 max-w-3xl flex-col gap-6 p-4 sm:p-8">
      {backLink}

      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="break-all font-heading text-2xl font-bold">{order.orderId}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <OrderStatusBadge status={order.status} />
          <PaymentStatusBadge status={order.paymentStatus} />
          <span className="text-sm text-muted-foreground">Placed {dateTime(order.createdAt)}</span>
        </div>
      </div>

      {/* Actions: one button per allowedNext entry from the API, plus Cancel while canCancel (OB-3). Notes, payment and
          print arrive in OB-4 and OB-5. */}
      <section aria-label="Order actions" data-slot="order-actions" className="flex flex-col gap-3 empty:hidden">
        {stockNotice ? (
          <p role="status" className="rounded-xl border bg-muted/40 p-3 text-sm">
            {stockNotice}
          </p>
        ) : null}

        {order.allowedNext.length > 0 || order.canCancel ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {order.allowedNext.map((target) => (
              <Button
                key={target}
                variant="clay"
                className="h-11 w-full sm:w-auto"
                disabled={running !== null}
                onClick={() => startTransition(target)}
              >
                {running === target ? "Saving…" : ACTION_LABEL[target] ?? ORDER_STATUS_LABEL[target] ?? target}
              </Button>
            ))}
            {order.canCancel ? (
              <CancelOrderDialog
                order={order}
                disabled={running !== null}
                onCancelled={handleCancelled}
                onConflict={handleCancelConflict}
              />
            ) : null}
          </div>
        ) : order.status === "delivered" ? (
          <p className="text-sm text-muted-foreground">No further steps. This order is delivered.</p>
        ) : null}

        {actionError ? (
          <div role="alert" className="flex flex-col gap-2 rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span>{actionError.message}</span>
            {actionError.retry ? (
              <Button
                variant="clay-soft"
                className="h-11 w-full sm:h-9 sm:w-auto"
                disabled={running !== null}
                onClick={() => actionError.retry && void runTransition(actionError.retry)}
              >
                Try again
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => (!open && running === null ? setConfirming(null) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirming ? CONFIRM_COPY[confirming]?.title : ""}</AlertDialogTitle>
            <AlertDialogDescription>{confirming ? CONFIRM_COPY[confirming]?.description : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 w-full sm:h-9 sm:w-auto" disabled={running !== null}>
              Not yet
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 w-full sm:h-9 sm:w-auto"
              disabled={running !== null}
              onClick={() => confirming && void runTransition(confirming)}
            >
              {running !== null ? "Saving…" : confirming ? ACTION_LABEL[confirming] : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <ul className="flex flex-col divide-y">
            {order.items.map((item, i) => (
              <li key={i} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2 first:pt-0">
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-medium">{item.productTitle}</span>
                  <span className="block break-words text-xs text-muted-foreground">
                    {item.variantTitle !== "Default" ? item.variantTitle : null}
                    {item.variantTitle !== "Default" && item.sku ? " · " : null}
                    {item.sku ? `SKU ${item.sku}` : null}
                  </span>
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    {money(item.unitPrice)} × {item.quantity}
                  </span>
                </span>
                <span className="tabular-nums font-medium">{money(item.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-1 border-t pt-3">
            <Row label="Subtotal">
              <span className="tabular-nums">{money(order.subtotal)}</span>
            </Row>
            <Row label="Delivery">
              <span className="tabular-nums">{order.deliveryCharges === 0 ? "Free" : money(order.deliveryCharges)}</span>
            </Row>
            <Row label="Total">
              <span className="tabular-nums font-semibold">{money(order.total)}</span>
            </Row>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Customer</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          <p className="break-words font-medium">{order.customerName ?? "—"}</p>
          {order.phone ? <p className="font-mono">{order.phone}</p> : null}
          {order.address ? <p className="break-words">{order.address}</p> : null}
          {order.city ? <p>{order.city}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <Row label="Method">{order.paymentMethod ? PAYMENT_METHOD_LABEL[order.paymentMethod] : "—"}</Row>
          <Row label="Status">
            <PaymentStatusBadge status={order.paymentStatus} />
          </Row>
          {order.collectedAt ? <Row label="Collected">{dateTime(order.collectedAt)}</Row> : null}
          {order.collectedAmount !== null ? (
            <Row label="Amount collected">
              <span className="tabular-nums">{money(order.collectedAmount)}</span>
            </Row>
          ) : null}
        </CardContent>
      </Card>

      {order.courier || order.trackingNumber || order.trackingUrl ? (
        <Card>
          <CardHeader>
            <CardTitle>Courier and tracking</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {order.courier ? <Row label="Courier">{order.courier}</Row> : null}
            {order.trackingNumber ? (
              <Row label="Tracking number">
                <span className="break-all font-mono">{order.trackingNumber}</span>
              </Row>
            ) : null}
            {order.trackingUrl ? (
              <Row label="Tracking link">
                <a href={order.trackingUrl} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline-offset-4 hover:underline">
                  Open tracking page
                </a>
              </Row>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {order.status === "cancelled" && (order.cancelledAt || order.cancelReason) ? (
        <Card>
          <CardHeader>
            <CardTitle>Cancellation</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {order.cancelledAt ? <Row label="Cancelled">{dateTime(order.cancelledAt)}</Row> : null}
            {order.cancelReason ? <Row label="Reason">{order.cancelReason}</Row> : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Status history</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {order.statusHistory.length === 0 ? (
            <p className="text-muted-foreground">No status changes yet.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {order.statusHistory.map((entry, i) => (
                <li key={i} className="flex flex-col gap-0.5">
                  <span>
                    {entry.from === entry.to
                      ? ORDER_STATUS_LABEL[entry.to]
                      : `${ORDER_STATUS_LABEL[entry.from]} → ${ORDER_STATUS_LABEL[entry.to]}`}
                  </span>
                  <span className="text-xs text-muted-foreground">{dateTime(entry.at)}</span>
                  {entry.note ? <span className="break-words text-xs text-muted-foreground">{entry.note}</span> : null}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {order.notes.length === 0 ? (
            <p className="text-muted-foreground">No notes. Notes are for your team only; the customer never sees them.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {order.notes.map((note, i) => (
                <li key={note.id ?? i} className="flex flex-col gap-0.5">
                  <span className="whitespace-pre-wrap break-words">{note.text}</span>
                  <span className="text-xs text-muted-foreground">{dateTime(note.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
