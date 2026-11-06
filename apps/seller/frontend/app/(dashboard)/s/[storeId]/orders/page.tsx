import type { Order as PayloadOrderDoc } from "@markaz/contracts";
import type { ListEnvelope as PayloadFindResponse } from "@markaz/api-compat";
import Link from "next/link";
import { resolveStorePage } from "@/lib/resolve-store-page";
import { storeHref } from "@/lib/store-routes";

import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { DataTable } from "@/components/dashboard/shared/DataTable";
import { StatusBadge } from "@/components/dashboard/shared/StatusBadge";
import { EmptyState } from "@/components/dashboard/shared/EmptyState";
import type { ColumnDef } from "@/components/dashboard/shared/DataTable";
import { ShoppingCart } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// DATA FETCHING — strictly untouched
// ─────────────────────────────────────────────────────────────────────────────

const PAYLOAD_API_URL = process.env.SELLER_BACKEND_API_URL || "http://localhost:4001";

const TABS = ["all", "pending", "confirmed", "dispatched", "delivered"] as const;
type Tab = (typeof TABS)[number];

async function fetchOrders(
  token: string,
  storeId: string,
  tab: Tab
): Promise<PayloadOrderDoc[]> {
  const conditions: Record<string, unknown>[] = [{ store: { equals: storeId } }];
  if (tab !== "all") conditions.push({ status: { equals: tab } });
  const where = encodeURIComponent(JSON.stringify({ and: conditions }));
  const res = await fetch(
    `${PAYLOAD_API_URL}/api/orders?where=${where}&sort=-createdAt&limit=100&depth=0`,
    { headers: { Authorization: `JWT ${token}`, "x-store-id": storeId }, cache: "no-store" }
  );
  if (!res.ok) return [];
  const data: PayloadFindResponse<PayloadOrderDoc> = await res.json();
  return data.docs;
}

// ─────────────────────────────────────────────────────────────────────────────
// FILTER CHIPS — mirrors the old Tabs, now rendered as outlined pill chips
// ─────────────────────────────────────────────────────────────────────────────

const FILTER_CHIPS = [
  { label: "All orders", value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Confirmed", value: "confirmed" },
  { label: "Dispatched", value: "dispatched" },
  { label: "Delivered", value: "delivered" },
];

// ─────────────────────────────────────────────────────────────────────────────
// TABLE COLUMNS
// ─────────────────────────────────────────────────────────────────────────────

function buildOrderColumns(storeId: string): ColumnDef<PayloadOrderDoc>[] {
  return [
  {
    header: "Order ID",
    render: (o) => (
      <Link
        href={storeHref(storeId, `/orders/${o.id}`)}
        className="font-mono text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {o.orderId}
      </Link>
    ),
  },
  { header: "Customer", accessorKey: "customerName" },
  {
    header: "Phone",
    accessorKey: "phone",
    className: "font-mono hidden md:table-cell",
  },
  { header: "City", accessorKey: "city", className: "hidden sm:table-cell" },
  {
    header: "Items",
    render: (o) => (
      <span className="tabular-nums">{o.items?.length ?? 0}</span>
    ),
    className: "text-center hidden lg:table-cell",
  },
  {
    header: "Total",
    render: (o) => (
      <span className="tabular-nums font-medium">
        PKR {o.total?.toLocaleString() ?? "—"}
      </span>
    ),
    className: "text-right",
  },
  {
    header: "Status",
    render: (o) => <StatusBadge status={o.status} />,
  },
  {
    header: "Date",
    render: (o) => (
      <span className="text-xs text-muted-foreground tabular-nums">
        {new Date(o.createdAt).toLocaleDateString()}
      </span>
    ),
    className: "hidden sm:table-cell",
  },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE
// ─────────────────────────────────────────────────────────────────────────────

export default async function DashboardOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  // ── Params ───────────────────────────────────────────────────────────────
  const { storeId } = await params;
  const { status } = await searchParams;
  const tab: Tab = TABS.includes(status as Tab) ? (status as Tab) : "all";

  // ── Store (from the URL, membership-checked) ─────────────────────────────
  const resolved = await resolveStorePage(storeId);
  if (!resolved.ok) return resolved.view;
  const { token } = resolved.ctx;

  // ── Data fetch (unchanged) ───────────────────────────────────────────────
  const orders = await fetchOrders(token, storeId, tab);

  return (
    <div className="flex flex-col gap-6 p-6 sm:p-8">
      {/* ── Page header ───────────────────────────────────────────────── */}
      <PageHeader
        title="Orders"
        className="mb-0"
        description={`${orders.length} order${orders.length !== 1 ? "s" : ""}${tab !== "all" ? ` · ${tab}` : ""}`}
      />

      {/* ── DataTable with toolbar ────────────────────────────────────── */}
      {/*
        Blueprint §5.5:
          - Filter chips rendered as outlined pills inside the DataTable toolbar.
            The active chip gets variant="default" (filled primary) to clearly
            show the current filter — same information hierarchy as the old Tabs
            but integrated into the table's own toolbar.
          - The old <Tabs variant="line"> below the PageHeader is removed.
            Chips ARE the filter; hrefs are now encoded in the chip values
            via the `onFilterChange` slot. But since this is a server component,
            filtering happens via URL (searchParams) — so the filter chips need
            to be rendered as links, not client buttons. We keep the DataTable
            purely server-side by rendering a client-free link-chip row above
            the table instead (the DataTable filterChips prop is for client
            components with state — here we use URL-driven server navigation).
      */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTER_CHIPS.map((chip) => (
          <Link
            key={chip.value}
            href={
              chip.value === "all"
                ? storeHref(storeId, "/orders")
                : storeHref(storeId, `/orders?status=${chip.value}`)
            }
            className={
              tab === chip.value
                ? // Active: filled primary pill
                  "inline-flex items-center rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-colors"
                : // Inactive: outlined pill
                  "inline-flex items-center rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            }
          >
            {chip.label}
          </Link>
        ))}
      </div>

      {/* ── Table or empty state ─────────────────────────────────────── */}
      {orders.length === 0 ? (
        <EmptyState
          title="No orders found"
          description={
            tab === "all"
              ? "Your orders will appear here once customers start buying."
              : `There are no ${tab} orders right now.`
          }
          icon={<ShoppingCart className="size-7" strokeWidth={1.5} />}
        />
      ) : (
        <DataTable
          data={orders}
          columns={buildOrderColumns(storeId)}
          keyExtractor={(o) => o.id}
          emptyState={
            <EmptyState
              title="No orders found"
              description="No orders match the current filter."
            />
          }
        />
      )}
    </div>
  );
}
