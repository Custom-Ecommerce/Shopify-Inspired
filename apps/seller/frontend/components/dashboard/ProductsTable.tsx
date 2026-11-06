"use client";

import type { SellerProductSummary } from "@markaz/contracts";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useStoreHref } from "@/lib/dashboard-context";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { runProductAction, type ProductAction } from "@/lib/product-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DeleteProductButton } from "@/components/dashboard/DeleteProductButton";
import { DataTable, type ColumnDef } from "@/components/dashboard/shared/DataTable";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { StatusBadge } from "@/components/dashboard/shared/StatusBadge";

const daysText = (days: number): string => (days === 1 ? "1 day" : `${days} days`);

/** The seller's product list, or the trash view when `trash` is set. The rows are the server page's. */
export function ProductsTable({ products, trash }: { products: SellerProductSummary[]; trash: boolean }) {
  const storeFetch = useStoreFetch();
  const href = useStoreHref();
  const router = useRouter();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const selectedRows = useMemo(() => products.filter((p) => selected.has(p.id)), [products, selected]);
  const allSelected = products.length > 0 && selectedRows.length === products.length;

  function toggle(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /** One request per product, so one refused product does not stop the rest, and each refusal can be named. */
  async function run(rows: SellerProductSummary[], action: ProductAction) {
    setBusy(true);
    let done = 0;
    const refusals: string[] = [];
    for (const row of rows) {
      const refusal = await runProductAction(storeFetch, row.id, action);
      if (refusal === null) done += 1;
      else refusals.push(`${row.title}: ${refusal}`);
    }
    setBusy(false);
    setSelected(new Set());
    if (done > 0) toast.success(`${action === "publish" ? "Published" : action === "unpublish" ? "Unpublished" : "Restored"} ${done} of ${rows.length}.`);
    for (const refusal of refusals) toast.error(refusal);
    router.refresh();
  }

  const titleColumn: ColumnDef<SellerProductSummary> = {
    header: "Title",
    render: (p) => (
      <span className="inline-flex items-center gap-2">
        {p.title}
        {p.isDemo ? <Badge variant="secondary">Demo</Badge> : null}
      </span>
    ),
  };

  const trashColumns: ColumnDef<SellerProductSummary>[] = [
    titleColumn,
    {
      header: "Deleted",
      render: (p) => (p.trash ? new Date(p.trash.deletedAt).toLocaleDateString() : "—"),
    },
    {
      header: "Purged in",
      render: (p) => (p.trash ? daysText(p.trash.daysLeft) : "—"),
    },
    {
      header: "",
      render: (p) =>
        p.trash?.restorable ? (
          <div className="flex items-center justify-end gap-4 whitespace-nowrap">
            <Button variant="link" size="sm" className="h-auto p-0" disabled={busy} onClick={() => run([p], "restore")}>
              Restore
            </Button>
            <DeleteProductButton productId={p.id} productTitle={p.title} mode="permanent" />
          </div>
        ) : (
          <span className="block text-right text-xs text-muted-foreground">Removed by an admin</span>
        ),
    },
  ];

  const listColumns: ColumnDef<SellerProductSummary>[] = [
    {
      header: (
        <Checkbox
          aria-label="Select all"
          checked={allSelected}
          onCheckedChange={(checked) => setSelected(checked === true ? new Set(products.map((p) => p.id)) : new Set())}
        />
      ),
      render: (p) => (
        <Checkbox
          aria-label={`Select ${p.title}`}
          checked={selected.has(p.id)}
          onCheckedChange={(checked) => toggle(p.id, checked === true)}
        />
      ),
      className: "w-10",
    },
    titleColumn,
    {
      header: "Price",
      render: (p) => `${p.variantCount > 1 ? "From " : ""}PKR ${p.minPrice.toLocaleString()}`,
    },
    { header: "Stock Qty", render: (p) => p.totalStock },
    { header: "Stock", render: (p) => <StatusBadge status={p.stockStatus} /> },
    { header: "Status", render: (p) => <StatusBadge status={p.status} /> },
    { header: "Category", render: (p) => p.categories[0]?.name ?? "—" },
    {
      header: "",
      render: (p) => (
        <div className="flex items-center justify-end gap-4 whitespace-nowrap">
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0"
            disabled={busy}
            onClick={() => run([p], p.status === "published" ? "unpublish" : "publish")}
          >
            {p.status === "published" ? "Unpublish" : "Publish"}
          </Button>
          <Button variant="link" size="sm" className="h-auto p-0" render={<Link href={href(`/products/${p.id}`)} />}>
            Edit
          </Button>
          <DeleteProductButton productId={p.id} productTitle={p.title} mode={p.isDemo ? "demo" : "trash"} />
        </div>
      ),
    },
  ];

  return (
    <>
      {trash ? (
        <p className="mb-3 text-sm text-muted-foreground">Products stay here for 365 days, then they are deleted for good.</p>
      ) : null}
      {selectedRows.length > 0 ? (
        <div className="mb-3 flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{selectedRows.length} selected</span>
          <Button variant="clay-soft" size="sm" disabled={busy} onClick={() => run(selectedRows, "publish")}>Publish</Button>
          <Button variant="clay-soft" size="sm" disabled={busy} onClick={() => run(selectedRows, "unpublish")}>Unpublish</Button>
        </div>
      ) : null}
      <SectionCard noPadding>
        <DataTable data={products} columns={trash ? trashColumns : listColumns} keyExtractor={(p) => p.id} />
      </SectionCard>
    </>
  );
}
