import type { DashboardOrderListItem, DashboardOrderListResponse, DashboardOrderStatus } from "@markaz/contracts";
import { Suspense } from "react";
import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { resolveStorePage } from "@/lib/resolve-store-page";
import { storeHref } from "@/lib/store-routes";
import { formatRs as money } from "@/lib/format";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { DataTable } from "@/components/dashboard/shared/DataTable";
import type { ColumnDef } from "@/components/dashboard/shared/DataTable";
import { EmptyState } from "@/components/dashboard/shared/EmptyState";
import { ErrorState } from "@/components/dashboard/shared/ErrorState";
import { OrderCheckbox, OrderSelectionBar, OrderSelectionProvider, SelectPageCheckbox } from "@/components/dashboard/orders/OrderSelection";
import {
  ORDER_STATUS_LABEL,
  OrderStatusBadge,
  PAYMENT_METHOD_LABEL,
  PaymentStatusBadge,
} from "@/components/dashboard/shared/StatusBadge";

// EP-02 OB-1b: the seller order list. Server-rendered from GET /api/orders, like the products page. Every filter lives in
// the URL (status, q, from, to, page), so the back button and a reload keep them.

const PAYLOAD_API_URL = process.env.SELLER_BACKEND_API_URL || "http://localhost:4001";
const PAGE_SIZE = 20;
const SEARCH_MAX_LENGTH = 40;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The tabs, in flow order. Returned is added only when the store has returned orders (EP-13). */
const STATUS_TABS: readonly DashboardOrderStatus[] = ["pending", "confirmed", "processing", "dispatched", "delivered", "cancelled"];
const ALL_STATUSES: readonly string[] = [...STATUS_TABS, "returned"];

type SearchParams = Record<string, string | string[] | undefined>;

interface OrderFilters {
  status: string;
  q: string;
  from: string;
  to: string;
  page: number;
}

const single = (value: string | string[] | undefined): string => (typeof value === "string" ? value : "");

/** What the URL asks for, cleaned: an unknown status or a malformed date is simply ignored. */
function readFilters(search: SearchParams): OrderFilters {
  const status = single(search.status);
  const from = single(search.from);
  const to = single(search.to);
  return {
    status: ALL_STATUSES.includes(status) ? status : "",
    q: single(search.q).trim().slice(0, SEARCH_MAX_LENGTH),
    from: DAY_PATTERN.test(from) ? from : "",
    to: DAY_PATTERN.test(to) ? to : "",
    page: Math.max(1, Number.parseInt(single(search.page), 10) || 1),
  };
}

/** The query string for a set of filters, without empty values and without page=1. */
function queryOf(filters: OrderFilters): string {
  const query = new URLSearchParams();
  if (filters.status) query.set("status", filters.status);
  if (filters.q) query.set("q", filters.q);
  if (filters.from) query.set("from", filters.from);
  if (filters.to) query.set("to", filters.to);
  if (filters.page > 1) query.set("page", String(filters.page));
  return query.toString();
}

function ordersHref(storeId: string, filters: OrderFilters): string {
  const query = queryOf(filters);
  return storeHref(storeId, query ? `/orders?${query}` : "/orders");
}

async function fetchOrders(token: string, storeId: string, filters: OrderFilters): Promise<DashboardOrderListResponse | null> {
  const query = new URLSearchParams(queryOf(filters));
  query.set("limit", String(PAGE_SIZE));
  try {
    const res = await fetch(`${PAYLOAD_API_URL}/api/orders?${query.toString()}`, {
      headers: { Authorization: `JWT ${token}`, "x-store-id": storeId },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as DashboardOrderListResponse;
  } catch {
    return null;
  }
}


const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Karachi" });

function PaymentCell({ order }: { order: DashboardOrderListItem }) {
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="text-xs text-muted-foreground">{order.paymentMethod ? PAYMENT_METHOD_LABEL[order.paymentMethod] : "—"}</span>
      <PaymentStatusBadge status={order.paymentStatus} />
    </span>
  );
}

function buildOrderColumns(storeId: string, pageIds: readonly string[]): ColumnDef<DashboardOrderListItem>[] {
  return [
    {
      header: <SelectPageCheckbox ids={pageIds} />,
      render: (o) => <OrderCheckbox id={o.id} label={`Select order ${o.orderId}`} />,
      className: "w-11 px-0",
    },
    {
      header: "Order",
      render: (o) => (
        <Link
          href={storeHref(storeId, `/orders/${o.id}`)}
          className="font-mono text-xs text-foreground underline-offset-4 hover:underline"
        >
          {o.orderId}
        </Link>
      ),
    },
    { header: "Status", render: (o) => <OrderStatusBadge status={o.status} /> },
    { header: "Payment", render: (o) => <PaymentCell order={o} /> },
    { header: "Customer", render: (o) => o.customerName ?? "—" },
    { header: "City", render: (o) => o.city ?? "—", className: "hidden md:table-cell" },
    {
      header: "Total",
      render: (o) => <span className="tabular-nums font-medium">{money(o.total)}</span>,
      className: "text-right",
    },
    {
      header: "Date",
      render: (o) => <span className="text-xs text-muted-foreground tabular-nums">{shortDate(o.createdAt)}</span>,
    },
  ];
}

/** Phone layout: one card per order, nothing wider than the screen. */
function OrderCard({ storeId, order }: { storeId: string; order: DashboardOrderListItem }) {
  return (
    <li className="flex items-start">
      <OrderCheckbox id={order.id} label={`Select order ${order.orderId}`} />
      <Link
        href={storeHref(storeId, `/orders/${order.id}`)}
        className="flex min-w-0 flex-1 flex-col gap-2 rounded-2xl border bg-card p-4 transition-colors hover:bg-muted/40"
      >
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-sm font-medium">{order.orderId}</span>
          <OrderStatusBadge status={order.status} className="shrink-0" />
        </span>
        <span className="min-w-0 break-words text-sm">
          {order.customerName ?? "—"}
          {order.city ? <span className="text-muted-foreground"> · {order.city}</span> : null}
        </span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {order.paymentMethod ? PAYMENT_METHOD_LABEL[order.paymentMethod] : "—"}
          <PaymentStatusBadge status={order.paymentStatus} />
        </span>
        <span className="flex items-center justify-between gap-2 text-sm">
          <span className="tabular-nums font-medium">{money(order.total)}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{shortDate(order.createdAt)}</span>
        </span>
      </Link>
    </li>
  );
}

function StatusTabs({ storeId, filters, list }: { storeId: string; filters: OrderFilters; list: DashboardOrderListResponse }) {
  const tabs: Array<{ value: string; label: string; count: number }> = [
    { value: "", label: "All", count: list.counts.all },
    ...STATUS_TABS.map((status) => ({ value: status, label: ORDER_STATUS_LABEL[status], count: list.counts[status] })),
  ];
  if (list.counts.returned > 0 || filters.status === "returned") {
    tabs.push({ value: "returned", label: ORDER_STATUS_LABEL.returned, count: list.counts.returned });
  }
  return (
    <nav aria-label="Order status" className="flex flex-wrap items-center gap-2">
      {tabs.map((tab) => {
        const active = filters.status === tab.value;
        return (
          <Link
            key={tab.value || "all"}
            href={ordersHref(storeId, { ...filters, status: tab.value, page: 1 })}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
                : "inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            }
          >
            {tab.label}
            <span className="tabular-nums opacity-70">{tab.count}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function OrdersLoading() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading orders">
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-7 w-20 rounded-full" />
        ))}
      </div>
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-2xl" />
      ))}
    </div>
  );
}

/** Tabs, list and pager. Rendered inside a Suspense boundary keyed on the filters, so a change shows the loading state. */
async function OrdersResults({ storeId, token, filters }: { storeId: string; token: string; filters: OrderFilters }) {
  const list = await fetchOrders(token, storeId, filters);

  if (list === null) {
    return (
      <div className="flex flex-col items-center gap-3">
        <ErrorState message="Could not load your orders." className="w-full" />
        {/* A full reload of the same URL is the retry: the list is rendered on the server. */}
        <Button variant="clay-soft" render={<a href={ordersHref(storeId, filters)} />}>Try again</Button>
      </div>
    );
  }

  const searching = filters.q !== "" || filters.from !== "" || filters.to !== "";
  const noOrdersAtAll = list.counts.all === 0 && !searching;
  const pageHref = (page: number): string => ordersHref(storeId, { ...filters, page });

  return (
    <div className="flex flex-col gap-4">
      <StatusTabs storeId={storeId} filters={filters} list={list} />

      {noOrdersAtAll ? (
        <EmptyState
          title="No orders yet"
          description="Your orders will appear here once customers start buying."
          icon={<ShoppingCart className="size-7" strokeWidth={1.5} />}
        />
      ) : list.docs.length === 0 ? (
        <EmptyState
          title="No matching orders"
          description="No order matches this search, date range or status. Try another filter or clear it."
          action={<Button variant="clay-soft" render={<Link href={storeHref(storeId, "/orders")} />}>Clear filters</Button>}
        />
      ) : (
        // Keyed on the filters and page, so changing either starts with nothing selected.
        <OrderSelectionProvider key={queryOf(filters)} storeId={storeId}>
          <div className="sm:hidden">
            <SelectPageCheckbox ids={list.docs.map((order) => order.id)} showText />
          </div>
          <ul className="flex flex-col gap-3 sm:hidden">
            {list.docs.map((order) => (
              <OrderCard key={order.id} storeId={storeId} order={order} />
            ))}
          </ul>
          <div className="hidden sm:block">
            <DataTable data={list.docs} columns={buildOrderColumns(storeId, list.docs.map((order) => order.id))} keyExtractor={(o) => o.id} />
          </div>
          <OrderSelectionBar />
        </OrderSelectionProvider>
      )}

      {list.totalPages > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            Page {list.page} of {list.totalPages}
          </span>
          <div className="flex gap-2">
            {list.hasPrevPage ? <Button variant="clay-soft" render={<Link href={pageHref(list.page - 1)} />}>Previous</Button> : null}
            {list.hasNextPage ? <Button variant="clay-soft" render={<Link href={pageHref(list.page + 1)} />}>Next</Button> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default async function DashboardOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { storeId } = await params;
  const resolved = await resolveStorePage(storeId);
  if (!resolved.ok) return resolved.view;
  const { token } = resolved.ctx;

  const filters = readFilters(await searchParams);
  const filtered = filters.q !== "" || filters.from !== "" || filters.to !== "";

  return (
    <div className="flex min-w-0 flex-col gap-6 p-4 sm:p-8">
      <PageHeader title="Orders" className="mb-0" />

      {/* A plain GET form: Enter or the button submits, and the filters land in the URL. The tab is kept, the page resets. */}
      <form className="flex flex-wrap items-end gap-2" role="search">
        {filters.status ? <input type="hidden" name="status" value={filters.status} /> : null}
        <label className="flex w-full min-w-0 flex-col gap-1 text-xs text-muted-foreground sm:w-64">
          Search
          <Input
            name="q"
            defaultValue={filters.q}
            maxLength={SEARCH_MAX_LENGTH}
            placeholder="Order number, phone or name"
            aria-label="Search orders by order number, phone or customer name"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
          From
          <Input type="date" name="from" defaultValue={filters.from} max={filters.to || undefined} className="w-40" />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
          To
          <Input type="date" name="to" defaultValue={filters.to} min={filters.from || undefined} className="w-40" />
        </label>
        <Button type="submit" variant="clay-soft">Search</Button>
        {filtered ? (
          <Button variant="link" render={<Link href={ordersHref(storeId, { status: filters.status, q: "", from: "", to: "", page: 1 })} />}>
            Clear
          </Button>
        ) : null}
      </form>

      <Suspense key={queryOf(filters)} fallback={<OrdersLoading />}>
        <OrdersResults storeId={storeId} token={token} filters={filters} />
      </Suspense>
    </div>
  );
}
