"use client";

import type { Product as PayloadProductDoc } from "@markaz/contracts";
import type { ListEnvelope as PayloadFindResponse } from "@markaz/api-compat";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { useState } from "react";

import { useDashboardFetch } from "@/lib/hooks/use-dashboard-fetch";
import { firstVariant, stockStatusOf } from "@/lib/product-stock";
import { RefreshButton } from "@/components/dashboard/shared/RefreshButton";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { StatusBadge } from "@/components/dashboard/shared/StatusBadge";
import { DataTable } from "@/components/dashboard/shared/DataTable";
import { LoadingState } from "@/components/dashboard/shared/LoadingState";
import { EmptyState } from "@/components/dashboard/shared/EmptyState";
import { ErrorState } from "@/components/dashboard/shared/ErrorState";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Phase 7.4 — same product set as `/dashboard/products`, sorted by
 * stockQuantity ascending, with a bulk "Update Stock" action. PATCHes
 * through the same `/api/dashboard/products/:id` proxy the Products page
 * uses for edit/delete — no new route needed here.
 */
export default function InventoryPage() {
  const storeFetch = useStoreFetch();
  const { data, loading, error: fetchError, refetch: load } = useDashboardFetch<PayloadFindResponse<PayloadProductDoc>>(
    "/api/dashboard/products?sort=stockQuantity&limit=100&depth=1"
  );
  const products = data?.docs ?? [];

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [newQuantity, setNewQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const error = fetchError || formError;

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkUpdate() {
    const qty = Number(newQuantity);
    if (Number.isNaN(qty) || qty < 0) {
      setFormError("Enter a valid quantity.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      for (const id of selected) {
        const product = products.find((p) => p.id === id);
        if (!product) continue;
        await storeFetch(`/api/dashboard/products/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stockQuantity: qty,
            reason: reason.trim() || "Manual bulk update",
          }),
        });
      }
      setModalOpen(false);
      setSelected(new Set());
      setNewQuantity("");
      setReason("");
      load();
    } catch {
      setFormError("Could not reach the backend. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    {
      header: "",
      render: (p: PayloadProductDoc) => (
        <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
      ),
    },
    { header: "Title", accessorKey: "title" as keyof PayloadProductDoc },
    {
      header: "Stock Qty",
      render: (p: PayloadProductDoc) => {
        const variant = firstVariant(p);
        const quantity = variant?.stockQuantity ?? 0;
        const low = quantity <= (variant?.lowStockThreshold ?? 5);
        return (
          <span className={`font-mono ${low ? "text-destructive font-medium" : ""}`}>
            {quantity}
          </span>
        );
      },
    },
    {
      header: "Threshold",
      render: (p: PayloadProductDoc) => (
        <span className="font-mono text-muted-foreground">{firstVariant(p)?.lowStockThreshold ?? 5}</span>
      ),
    },
    {
      header: "Status",
      render: (p: PayloadProductDoc) => <StatusBadge status={stockStatusOf(firstVariant(p))} />,
    },
  ];

  return (
    <div className="p-6 sm:p-8">
      <PageHeader title="Inventory">
        <div className="flex gap-2">
          {selected.size > 0 && (
            <Button variant="clay" onClick={() => setModalOpen(true)}>Update Stock ({selected.size})</Button>
          )}
          <RefreshButton />
        </div>
      </PageHeader>

      {error ? (
        <ErrorState message={error} onRetry={load} className="mb-6" />
      ) : loading ? (
        <LoadingState />
      ) : products.length === 0 ? (
        <EmptyState title="No products yet" description="Your inventory will appear here." />
      ) : (
        <SectionCard noPadding>
          <DataTable
            data={products}
            columns={columns}
            keyExtractor={(p) => p.id}
          />
        </SectionCard>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Update stock for {selected.size} product(s)</DialogTitle>
    </DialogHeader>
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="newQuantity" className="mb-1">New quantity</Label>
        <Input
          id="newQuantity"
          type="number"
          min={0}
          value={newQuantity}
          onChange={(e) => setNewQuantity(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="reason" className="mb-1">Reason</Label>
        <Input
          id="reason"
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. restock, correction"
        />
      </div>
      {formError && <p className="text-xs text-destructive">{formError}</p>}
    </div>
    <DialogFooter>
      <Button variant="clay-soft" onClick={() => setModalOpen(false)} disabled={saving}>
        Cancel
      </Button>
      <Button variant="clay" onClick={handleBulkUpdate} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
    </div>
  );
}
