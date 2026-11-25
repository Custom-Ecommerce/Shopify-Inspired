"use client";

import { useCallback, useMemo, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { AdminOrderRow } from "@markaz/contracts";
import { TablePagination } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { getOrder, listOrders } from "@/lib/api/client";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useAdminFetch } from "@/lib/hooks/use-admin-fetch";
import { ORDER_STATUS_LABELS, ORDER_STATUS_VALUES, itemCountText, orderStateToQuery, orderTitle, parseOrderListState, paymentMethodText, rangeProblem, totalsLines, type OrderListState } from "@/lib/orders";
import { formatRs } from "@/lib/subscription-payments";

/**
 * The read-only Orders page at /orders (Sprint 6 S6-B5). Orders from every store, SAFE fields only: the console never receives a shopper's name,
 * phone, address or email. Opening an order is audited. One column of cards from 375 px up; the detail opens in a full-height drawer.
 */
export function OrdersView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const state = useMemo(() => parseOrderListState(searchParams), [searchParams]);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState({ from: state.from, to: state.to, q: state.q });
  const problem = rangeProblem(draft);

  const go = useCallback(
    (next: OrderListState) => {
      const query = orderStateToQuery(next);
      router.replace(query === "" ? pathname : pathname + "?" + query);
    },
    [router, pathname],
  );
  const { data, error, loading, refetch } = useAdminFetch((signal) => listOrders(state, signal), [state.page, state.status, state.store, state.from, state.to, state.q]);

  function apply(event: FormEvent) {
    event.preventDefault();
    if (problem === null) go({ ...state, ...draft, q: draft.q.trim(), page: 1 });
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h2 className="font-heading mb-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Orders</h2>
        <p className="text-sm text-muted-foreground">Every store's orders, read only. Shoppers' names, phones and addresses are never shown here.</p>
      </div>

      <form onSubmit={apply} className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end" role="search">
        <Select aria-label="Filter by status" className="sm:w-44" value={state.status} onChange={(event) => go({ ...state, status: event.target.value as OrderListState["status"], page: 1 })}>
          <option value="">All statuses</option>
          {ORDER_STATUS_VALUES.map((status) => (
            <option key={status} value={status}>
              {ORDER_STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
        <Input aria-label="Order number" placeholder="Order number" className="min-h-11 sm:w-44" value={draft.q} maxLength={40} onChange={(event) => setDraft((d) => ({ ...d, q: event.target.value }))} />
        <Input aria-label="From date" type="date" className="min-h-11 sm:w-40" value={draft.from} onChange={(event) => setDraft((d) => ({ ...d, from: event.target.value }))} />
        <Input aria-label="To date" type="date" className="min-h-11 sm:w-40" value={draft.to} onChange={(event) => setDraft((d) => ({ ...d, to: event.target.value }))} />
        <Button type="submit" className="min-h-11" disabled={problem !== null}>
          Apply
        </Button>
        {state.store !== "" ? (
          <Button variant="outline" className="min-h-11" onClick={() => go({ ...state, store: "", page: 1 })}>
            All stores
          </Button>
        ) : null}
      </form>
      {problem !== null ? (
        <p role="alert" className="-mt-3 text-sm text-destructive">
          {problem}
        </p>
      ) : null}

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
            <Skeleton key={key} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : (data?.docs.length ?? 0) === 0 ? (
        <Card className="bg-muted/30 px-4 py-12 text-center">
          <p className="font-heading text-lg font-semibold text-foreground">No orders match</p>
          <p className="mt-1 text-sm text-muted-foreground">Try a different filter.</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Orders" data-slot="order-list">
          {data?.docs.map((order) => (
            <OrderCard key={order.id} order={order} onOpen={() => setOpen(order.id)} />
          ))}
        </ul>
      )}

      {data ? <TablePagination page={data.page} totalPages={data.totalPages} totalDocs={data.totalDocs} noun="order" disabled={loading} onPage={(page) => go({ ...state, page })} /> : null}
      {open !== null ? <OrderDrawer key={open} id={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function OrderCard({ order, onOpen }: { order: AdminOrderRow; onOpen: () => void }) {
  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-all text-sm font-semibold">{order.orderNumber}</p>
          <p className="break-words text-xs text-muted-foreground">{order.storeName ?? order.storeId}</p>
        </div>
        <StatusBadge status={order.status === "cancelled" ? "failed" : order.status === "delivered" ? "paid" : "pending"} label={ORDER_STATUS_LABELS[order.status]} />
      </div>
      <p className="mt-2 text-sm">
        <span className="font-medium">{formatRs(order.total)}</span> · {paymentMethodText(order.paymentMethod)} · {itemCountText(order.itemCount)}
        {order.city ? " · " + order.city : ""}
      </p>
      <p className="text-xs text-muted-foreground">{formatRelative(order.createdAt)}</p>
      <Button variant="outline" className="mt-3 min-h-11 w-full sm:w-auto" onClick={onOpen}>
        View order
      </Button>
    </li>
  );
}

function OrderDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error, loading, refetch } = useAdminFetch((signal) => getOrder(id, signal), [id]);
  return (
    <Dialog open onClose={onClose} title={data ? orderTitle(data) : "Order"} description={data ? (data.storeName ?? data.storeId) + " · " + formatDateTime(data.createdAt) : undefined} className="sm:ml-auto sm:max-w-md">
      {loading && !data ? <Skeleton className="h-40 w-full" aria-busy /> : null}
      {error !== null && !data ? (
        <div role="alert" className="flex flex-col gap-2 text-sm text-destructive">
          <p>{error.message}</p>
          <Button variant="outline" size="sm" onClick={refetch}>
            Try again
          </Button>
        </div>
      ) : null}
      {data ? (
        <div className="flex flex-col gap-4 text-sm" data-slot="order-detail">
          <p>
            {ORDER_STATUS_LABELS[data.status]} · {paymentMethodText(data.paymentMethod)}
            {data.city ? " · Delivery to " + data.city : ""}
          </p>
          <p className="text-muted-foreground">
            Payment: {data.paymentStatus} · Confirmation: {data.confirmationStatus.replace("_", " ")}
          </p>
          <ul className="flex flex-col gap-1" aria-label="Items">
            {data.items.map((item, index) => (
              <li key={index} className="flex justify-between gap-3">
                <span className="min-w-0 break-words">
                  {item.name} × {item.quantity}
                </span>
                <span className="tabular-nums">{formatRs(item.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t border-border pt-3">
            {totalsLines(data.totals).map((line) => (
              <div key={line.label} className="contents">
                <dt className="text-muted-foreground">{line.label}</dt>
                <dd className="text-right tabular-nums">{line.value}</dd>
              </div>
            ))}
          </dl>
          <div>
            <p className="font-medium">History</p>
            <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
              {data.statusHistory.map((entry, index) => (
                <li key={index}>
                  {ORDER_STATUS_LABELS[entry.from]} to {ORDER_STATUS_LABELS[entry.to]} · {formatDateTime(entry.at)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
