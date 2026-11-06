import { resolveStorePage } from "@/lib/resolve-store-page";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { MetricTile } from "@/components/dashboard/shared/MetricTile";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { StatusBadge } from "@/components/dashboard/shared/StatusBadge";
import { DataTable } from "@/components/dashboard/shared/DataTable";
import { EmptyState } from "@/components/dashboard/shared/EmptyState";
import { DollarSign, TrendingDown, Wallet, Clock } from "lucide-react";

const PAYLOAD_API_URL = process.env.SELLER_BACKEND_API_URL || "http://localhost:4001";

interface LedgerEntry {
  id: string;
  order: string | { orderId?: string };
  orderAmount: number;
  commissionAmount: number;
  status: "pending" | "settled";
  settlementDate?: string | null;
  createdAt: string;
}

export default async function DashboardEarningsPage({
  params,
}: {
  params: Promise<{ storeId: string }>;
}) {
  const { storeId } = await params;
  const resolved = await resolveStorePage(storeId);
  if (!resolved.ok) return resolved.view;
  const { token } = resolved.ctx;

  let entries: LedgerEntry[] = [];
  let summary = { totalRevenue: 0, totalCommission: 0, netPayable: 0, pendingCommission: 0, settledCommission: 0 };
  try {
    const res = await fetch(`${PAYLOAD_API_URL}/api/stores/${encodeURIComponent(storeId)}/earnings`, {
      headers: { Authorization: `JWT ${token}`, "x-store-id": storeId },
      cache: "no-store",
    });
    if (res.ok) {
      const data = await res.json();
      entries = data.entries ?? [];
      summary = data.summary ?? summary;
    }
  } catch (err) {
    console.error("[dashboard/earnings] Failed to fetch:", err);
  }

  const columns = [
    {
      header: "Order",
      render: (entry: LedgerEntry) => (
        <span className="font-mono">
          {typeof entry.order === "object" ? entry.order?.orderId : entry.order}
        </span>
      ),
    },
    {
      header: "Amount",
      render: (entry: LedgerEntry) => (
        <span className="tabular-nums">PKR {entry.orderAmount.toLocaleString()}</span>
      ),
    },
    {
      header: "Commission",
      render: (entry: LedgerEntry) => (
        <span className="tabular-nums">PKR {entry.commissionAmount.toLocaleString()}</span>
      ),
    },
    {
      header: "Status",
      render: (entry: LedgerEntry) => <StatusBadge status={entry.status} />,
    },
    {
      header: "Date",
      render: (entry: LedgerEntry) => (
        <span className="text-xs text-muted-foreground tabular-nums">
          {new Date(entry.createdAt).toLocaleDateString()}
        </span>
      ),
    },
  ];

  return (
    <div className="p-6 sm:p-8 flex flex-col gap-6">
      <PageHeader title="Earnings" description="Your revenue and commission summary" className="mb-0" />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:gap-6">
        <MetricTile
          label="Total Revenue"
          value={summary.totalRevenue > 0 ? `PKR ${summary.totalRevenue.toLocaleString()}` : "—"}
          icon={DollarSign}
          coinVariant="brand"
        />
        <MetricTile
          label="Total Commission"
          value={summary.totalCommission > 0 ? `PKR ${summary.totalCommission.toLocaleString()}` : "—"}
          icon={TrendingDown}
        />
        <MetricTile
          label="Net Payable"
          value={summary.netPayable > 0 ? `PKR ${summary.netPayable.toLocaleString()}` : "—"}
          icon={Wallet}
        />
        <MetricTile
          label="Pending Commission"
          value={summary.pendingCommission > 0 ? `PKR ${summary.pendingCommission.toLocaleString()}` : "—"}
          icon={Clock}
        />
      </div>

      <SectionCard title="Settlement History" noPadding>
        {entries.length === 0 ? (
          <div className="px-5 py-5">
            <EmptyState
              title="No delivered orders yet"
              description="Your settlement history will appear here once orders are completed."
            />
          </div>
        ) : (
          <DataTable
            data={entries}
            columns={columns}
            keyExtractor={(entry) => entry.id}
          />
        )}
      </SectionCard>
    </div>
  );
}
