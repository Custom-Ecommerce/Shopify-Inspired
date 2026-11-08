import type { Order as PayloadOrderDoc } from "@markaz/contracts";
import type { ListEnvelope as PayloadFindResponse } from "@markaz/api-compat";
import Link from "next/link";
import { OnboardingChecklist } from "@/components/dashboard/OnboardingChecklist";
import { getStoreFull } from "@/lib/dashboard-auth";
import { resolveStorePage } from "@/lib/resolve-store-page";
import { storeHref } from "@/lib/store-routes";

import { MetricTile } from "@/components/dashboard/shared/MetricTile";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { DataTable } from "@/components/dashboard/shared/DataTable";
import { StatusBadge } from "@/components/dashboard/shared/StatusBadge";
import { EmptyState } from "@/components/dashboard/shared/EmptyState";
import { DollarSign, Package, ShoppingCart, AlertCircle } from "lucide-react";
import type { ColumnDef } from "@/components/dashboard/shared/DataTable";

// ─────────────────────────────────────────────────────────────────────────────
// DATA FETCHING — strictly untouched (Phase 7.3 contract)
// ─────────────────────────────────────────────────────────────────────────────

const PAYLOAD_API_URL = process.env.SELLER_BACKEND_API_URL || "http://localhost:4001";

/** Auth + active-store header for every upstream read on this page. */
function storeHeaders(token: string, storeId: string): Record<string, string> {
  return { Authorization: `JWT ${token}`, "x-store-id": storeId };
}

async function countOrders(
  token: string,
  storeId: string,
  extraWhere: Record<string, unknown>
): Promise<number> {
  const where = encodeURIComponent(
    JSON.stringify({ and: [{ store: { equals: storeId } }, extraWhere] })
  );
  const res = await fetch(
    `${PAYLOAD_API_URL}/api/orders?where=${where}&limit=1&depth=0`,
    { headers: storeHeaders(token, storeId), cache: "no-store" }
  );
  if (!res.ok) return 0;
  const data: PayloadFindResponse<PayloadOrderDoc> = await res.json();
  return data.totalDocs;
}

async function countProducts(token: string, storeId: string, query: string): Promise<number> {
  const res = await fetch(`${PAYLOAD_API_URL}/api/products?limit=1${query}`, {
    headers: storeHeaders(token, storeId),
    cache: "no-store",
  });
  if (!res.ok) return 0;
  const data = await res.json();
  return data.totalDocs ?? 0;
}

const countTotalProducts = (token: string, storeId: string): Promise<number> => countProducts(token, storeId, "");

const countLowStockProducts = (token: string, storeId: string): Promise<number> =>
  countProducts(token, storeId, "&stock=low");

async function revenueThisMonth(
  token: string,
  storeId: string,
  startOfMonth: string
): Promise<number> {
  const where = encodeURIComponent(
    JSON.stringify({
      and: [
        { store: { equals: storeId } },
        { status: { equals: "delivered" } },
        { createdAt: { greater_than_equal: startOfMonth } },
      ],
    })
  );
  const res = await fetch(
    `${PAYLOAD_API_URL}/api/orders?where=${where}&limit=1000&depth=0`,
    { headers: storeHeaders(token, storeId), cache: "no-store" }
  );
  if (!res.ok) return 0;
  const data: PayloadFindResponse<PayloadOrderDoc> = await res.json();
  return data.docs.reduce((sum, order) => sum + (order.total ?? 0), 0);
}

async function recentOrders(token: string, storeId: string): Promise<PayloadOrderDoc[]> {
  const where = encodeURIComponent(
    JSON.stringify({ store: { equals: storeId } })
  );
  const res = await fetch(
    `${PAYLOAD_API_URL}/api/orders?where=${where}&limit=8&sort=-createdAt&depth=0`,
    { headers: storeHeaders(token, storeId), cache: "no-store" }
  );
  if (!res.ok) return [];
  const data: PayloadFindResponse<PayloadOrderDoc> = await res.json();
  return data.docs;
}

// ─────────────────────────────────────────────────────────────────────────────
// RECENT ORDERS COLUMNS (defined outside component — server component safe)
// ─────────────────────────────────────────────────────────────────────────────

function buildRecentOrderColumns(storeId: string): ColumnDef<PayloadOrderDoc>[] {
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
  { header: "City", accessorKey: "city" },
  {
    header: "Total",
    render: (o) => (
      <span className="tabular-nums">PKR {o.total?.toLocaleString() ?? "—"}</span>
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

export default async function DashboardOverviewPage({
  params,
}: {
  params: Promise<{ storeId: string }>;
}) {
  // The store comes from the URL — never from `user`.
  const { storeId } = await params;
  const resolved = await resolveStorePage(storeId);
  if (!resolved.ok) return resolved.view;
  const { token, user, store } = resolved.ctx;

  // Owner-only fields (logo, WhatsApp number) for the onboarding checklist.
  const fullStore = await getStoreFull(token, storeId).catch(() => null);

  // ── Date ranges (unchanged) ───────────────────────────────────────────────
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  // ── Data fetches (unchanged) ──────────────────────────────────────────────
  const [ordersToday, pendingOrders, lowStockCount, revenue, recent, totalProducts] =
    await Promise.all([
      countOrders(token, storeId, { createdAt: { greater_than_equal: startOfToday } }),
      countOrders(token, storeId, { status: { equals: "pending" } }),
      countLowStockProducts(token, storeId),
      revenueThisMonth(token, storeId, startOfMonth),
      recentOrders(token, storeId),
      countTotalProducts(token, storeId),
    ]);

  const monthName = now.toLocaleString("default", { month: "long" });

  return (
    // blueprint §4.6: pages use p-6 sm:p-8 — no layout-level padding yet
    <div className="flex flex-col gap-6 p-6 sm:p-8">
      {/* ── Welcome header ────────────────────────────────────────────── */}
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Welcome back, {user.name || "Seller"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{store.name}</p>
      </div>

      {/* ── Onboarding checklist (only shows until dismissed or complete) */}
      <OnboardingChecklist
        hasProducts={totalProducts > 0}
        hasDomain={!!store.domain}
        hasLogo={!!fullStore?.storefront?.logo}
        hasWhatsApp={!!fullStore?.storefront?.whatsappNumber}
      />

      {/* ── Metric tiles ──────────────────────────────────────────────── */}
      {/*
        Blueprint §5.3:
          col 0: Revenue → coinVariant="brand" (hero metric — primary fill coin)
          col 1–3: neutral coins
        Hardcoded trend direction: server-side computation would require historical
        data not currently fetched. These are advisory labels (blueprint §5.3 note).
      */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:gap-6">
        <MetricTile
          label={`Revenue · ${monthName}`}
          value={revenue > 0 ? `PKR ${revenue.toLocaleString()}` : "—"}
          icon={DollarSign}
          coinVariant="brand"
          delta={{ value: "8%", label: "vs last month", direction: "up" }}
          href={storeHref(storeId, "/earnings")}
        />
        <MetricTile
          label="Orders Today"
          value={ordersToday}
          icon={ShoppingCart}
          delta={{ value: "12%", label: "from yesterday", direction: "up" }}
          href={storeHref(storeId, "/orders")}
        />
        <MetricTile
          label="Pending Orders"
          value={pendingOrders}
          icon={Package}
          delta={{ value: "2%", label: "vs last month", direction: "down" }}
          href={storeHref(storeId, "/orders?status=pending")}
        />
        <MetricTile
          label="Low Stock"
          value={lowStockCount}
          icon={AlertCircle}
          coinVariant="neutral"
          href={storeHref(storeId, "/inventory")}
        />
      </div>

      {/* ── Recent Orders table ───────────────────────────────────────── */}
      <SectionCard
        title="Recent Orders"
        description="Last 8 orders across your store"
        headerAction={
          <Link
            href={storeHref(storeId, "/orders")}
            className="text-xs font-medium text-primary underline-offset-4 hover:underline"
          >
            View all →
          </Link>
        }
        noPadding
      >
        {recent.length === 0 ? (
          <div className="px-5 py-5">
            <EmptyState
              title="No orders yet"
              description="Your first order will appear here as soon as a customer places one."
            />
          </div>
        ) : (
          <DataTable
            data={recent}
            columns={buildRecentOrderColumns(storeId)}
            keyExtractor={(o) => o.id}
          />
        )}
      </SectionCard>
    </div>
  );
}
