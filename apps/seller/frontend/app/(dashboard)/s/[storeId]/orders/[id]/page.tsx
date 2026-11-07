"use client";

import type { DashboardOrderDetail } from "@markaz/contracts";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { storeHref } from "@/lib/store-routes";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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

export default function OrderDetailPage() {
  const storeFetch = useStoreFetch();
  const params = useParams<{ storeId: string; id: string }>();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const load = useCallback(() => {
    setState({ kind: "loading" });
    storeFetch(`/api/dashboard/orders/${params.id}`)
      .then(async (res) => {
        if (res.status === 404) return setState({ kind: "not_found" });
        const data = (await res.json().catch(() => null)) as DashboardOrderDetail | null;
        if (!res.ok || !data?.id) return setState({ kind: "error" });
        setState({ kind: "ready", order: data });
      })
      .catch(() => setState({ kind: "error" }));
  }, [params.id, storeFetch]);

  useEffect(load, [load]);

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

      {/* Actions: intentionally empty. OB-2 fills this area from the allowed next steps the API returns
          (confirm, processing, dispatch, delivered); cancel, notes, payment and print arrive in OB-3 to OB-5. */}
      <div data-slot="order-actions" className="empty:hidden" />

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
