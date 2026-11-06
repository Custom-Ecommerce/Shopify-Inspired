"use client";

import type { SellerProductSummary } from "@markaz/contracts";
import type { ListEnvelope } from "@markaz/api-compat";

import { useDashboardFetch } from "@/lib/hooks/use-dashboard-fetch";
import { RefreshButton } from "@/components/dashboard/shared/RefreshButton";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { StatusBadge } from "@/components/dashboard/shared/StatusBadge";
import { DataTable } from "@/components/dashboard/shared/DataTable";
import { LoadingState } from "@/components/dashboard/shared/LoadingState";
import { EmptyState } from "@/components/dashboard/shared/EmptyState";
import { ErrorState } from "@/components/dashboard/shared/ErrorState";

const columns = [
  { header: "Title", accessorKey: "title" as keyof SellerProductSummary },
  {
    header: "Stock Qty",
    render: (p: SellerProductSummary) => <span className="font-mono">{p.totalStock}</span>,
  },
  { header: "Variants", render: (p: SellerProductSummary) => p.variantCount },
  { header: "Status", render: (p: SellerProductSummary) => <StatusBadge status={p.stockStatus} /> },
];

/**
 * Read-only for now: the store's products, lowest stock first. Stock only ever changes through an atomic adjustment
 * with history (D-034); the bulk "Update Stock" action returns with that endpoint.
 */
export default function InventoryPage() {
  const { data, loading, error, refetch: load } = useDashboardFetch<ListEnvelope<SellerProductSummary>>(
    "/api/dashboard/products?limit=100"
  );
  const products = [...(data?.docs ?? [])].sort((a, b) => a.totalStock - b.totalStock);

  return (
    <div className="p-6 sm:p-8">
      <PageHeader title="Inventory">
        <RefreshButton />
      </PageHeader>

      {error ? (
        <ErrorState message={error} onRetry={load} className="mb-6" />
      ) : loading ? (
        <LoadingState />
      ) : products.length === 0 ? (
        <EmptyState title="No products yet" description="Your inventory will appear here." />
      ) : (
        <SectionCard noPadding>
          <DataTable data={products} columns={columns} keyExtractor={(p) => p.id} />
        </SectionCard>
      )}
    </div>
  );
}
