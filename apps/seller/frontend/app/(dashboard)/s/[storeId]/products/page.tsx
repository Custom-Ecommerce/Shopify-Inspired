import type { Product as PayloadProductDoc } from "@markaz/contracts";
import type { ListEnvelope as PayloadFindResponse } from "@markaz/api-compat";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { resolveStorePage } from "@/lib/resolve-store-page";
import { storeHref } from "@/lib/store-routes";

import { DeleteProductButton } from "@/components/dashboard/DeleteProductButton";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { StatusBadge } from "@/components/dashboard/shared/StatusBadge";
import { DataTable } from "@/components/dashboard/shared/DataTable";
import { EmptyState } from "@/components/dashboard/shared/EmptyState";

const PAYLOAD_API_URL = process.env.SELLER_BACKEND_API_URL || "http://localhost:4001";

async function fetchProducts(token: string, storeId: string): Promise<PayloadProductDoc[]> {
  const where = encodeURIComponent(JSON.stringify({ store: { equals: storeId } }));
  const res = await fetch(`${PAYLOAD_API_URL}/api/products?where=${where}&limit=50&depth=1`, {
    headers: { Authorization: `JWT ${token}`, "x-store-id": storeId },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data: PayloadFindResponse<PayloadProductDoc> = await res.json();
  return data.docs;
}

export default async function DashboardProductsPage({
  params,
}: {
  params: Promise<{ storeId: string }>;
}) {
  const { storeId } = await params;
  const resolved = await resolveStorePage(storeId);
  if (!resolved.ok) return resolved.view;
  const { token } = resolved.ctx;

  const products = await fetchProducts(token, storeId);

  const productColumns = [
    { header: "Title", accessorKey: "title" as const },
    {
      header: "Price",
      render: (p: PayloadProductDoc) => `PKR ${p.price.toLocaleString()}`,
    },
    { header: "Stock Qty", accessorKey: "stockQuantity" as const },
    {
      header: "Status",
      render: (p: PayloadProductDoc) => <StatusBadge status={p.stockStatus} />,
    },
    {
      header: "Category",
      render: (p: PayloadProductDoc) =>
        typeof p.categories?.[0] === "object" ? p.categories[0]?.name : "—",
    },
    {
      header: "",
      render: (p: PayloadProductDoc) => (
        <div className="flex items-center justify-end gap-4 whitespace-nowrap">
          <Button variant="link" size="sm" className="h-auto p-0" render={<Link href={storeHref(storeId, `/products/${p.id}`)} />}>
            Edit
          </Button>
          <DeleteProductButton productId={p.id} productTitle={p.title} />
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 sm:p-8">
      <PageHeader title="Products">
        <Button variant="clay-soft" render={<Link href={storeHref(storeId, "/products/import")} />}>Import CSV</Button>
        <Button variant="clay-soft" render={<a href={`/api/dashboard/products/export?storeId=${encodeURIComponent(storeId)}`} />}>Export CSV</Button>
        <Button variant="clay" render={<Link href={storeHref(storeId, "/products/new")} />}>Add Product</Button>
      </PageHeader>

      {products.length === 0 ? (
        <EmptyState title="No products yet" description="Start adding products to your store." />
      ) : (
        <SectionCard noPadding>
          <DataTable
            data={products}
            columns={productColumns}
            keyExtractor={(p) => p.id}
          />
        </SectionCard>
      )}
    </div>
  );
}
