"use client";

import type { InventoryAdjustResponse, InventoryProduct, InventoryVariant, StockHistoryEntry } from "@markaz/contracts";
import type { ListEnvelope } from "@markaz/api-compat";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { useDashboardFetch } from "@/lib/hooks/use-dashboard-fetch";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { refusalMessage } from "@/lib/product-actions";
import { RefreshButton } from "@/components/dashboard/shared/RefreshButton";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { StatusBadge } from "@/components/dashboard/shared/StatusBadge";
import { DataTable, type ColumnDef } from "@/components/dashboard/shared/DataTable";
import { LoadingState } from "@/components/dashboard/shared/LoadingState";
import { EmptyState } from "@/components/dashboard/shared/EmptyState";
import { ErrorState } from "@/components/dashboard/shared/ErrorState";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

interface Row {
  product: InventoryProduct;
  variant: InventoryVariant;
}

const DEFAULT_REASON = "Stock count";
const PAGE_SIZE = 50;

/** The small history panel: the last changes to one variant, newest first. */
function StockHistory({ row, onClose }: { row: Row; onClose: () => void }) {
  const storeFetch = useStoreFetch();
  const [page, setPage] = useState(1);
  const [history, setHistory] = useState<ListEnvelope<StockHistoryEntry> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { product, variant } = row;

  useEffect(() => {
    let current = true;
    const query = new URLSearchParams({ productId: product.id, variantId: variant.id, page: String(page), limit: "10" });
    storeFetch(`/api/dashboard/inventory/history?${query.toString()}`)
      .then(async (res) => {
        const body: unknown = await res.json();
        if (!current) return;
        if (res.ok) setHistory(body as ListEnvelope<StockHistoryEntry>);
        else setError(refusalMessage(body, "Could not load the history."));
      })
      .catch(() => current && setError("Could not reach the backend."));
    return () => {
      current = false;
    };
  }, [storeFetch, product.id, variant.id, page]);

  const columns: ColumnDef<StockHistoryEntry>[] = [
    { header: "When", render: (entry) => new Date(entry.changedAt).toLocaleString() },
    { header: "Change", render: (entry) => <span className="font-mono">{entry.delta > 0 ? `+${entry.delta}` : entry.delta}</span> },
    { header: "Stock", render: (entry) => <span className="font-mono">{entry.previousQuantity} → {entry.quantity}</span> },
    { header: "Reason", render: (entry) => entry.reason },
    { header: "By", render: (entry) => (entry.actor ? "You" : "Order") },
  ];

  return (
    <SectionCard noPadding className="mt-6">
      <div className="flex items-center justify-between px-5 py-3">
        <h2 className="font-heading text-sm font-semibold">Stock history: {product.title} ({variant.title})</h2>
        <Button variant="link" size="sm" className="h-auto p-0" onClick={onClose}>Close</Button>
      </div>
      {error ? (
        <ErrorState message={error} />
      ) : !history ? (
        <LoadingState />
      ) : (
        <>
          <DataTable data={history.docs} columns={columns} keyExtractor={(entry) => entry.id} />
          {history.totalPages > 1 ? (
            <div className="flex items-center justify-between px-5 py-3 text-sm">
              <span className="text-muted-foreground">Page {page} of {history.totalPages}</span>
              <div className="flex gap-2">
                <Button variant="clay-soft" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button variant="clay-soft" size="sm" disabled={page >= history.totalPages} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}

/**
 * Per-variant stock. A quantity goes through the adjust endpoint, as the count the seller entered: the backend works out
 * the change from what it holds at that moment, so a sale made while this page was open is never overwritten (D-034).
 * The low-stock threshold and the track toggle are product edits, through PATCH.
 *
 * This page is the only place stock changes, so every product has to be reachable: it searches and pages. Unsaved counts
 * belong to the rows on screen, so both stay locked until those counts are saved or put back.
 */
export default function InventoryPage() {
  const storeFetch = useStoreFetch();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const listQuery = new URLSearchParams({ q: query, page: String(page), limit: String(PAGE_SIZE) });
  const { data, loading, error, refetch } = useDashboardFetch<ListEnvelope<InventoryProduct>>(`/api/dashboard/inventory?${listQuery.toString()}`);

  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState(DEFAULT_REASON);
  const [saving, setSaving] = useState(false);
  const [historyOf, setHistoryOf] = useState<Row | null>(null);

  const rows = useMemo<Row[]>(
    () => (data?.docs ?? []).flatMap((product) => product.variants.map((variant) => ({ product, variant }))),
    [data],
  );

  const edited = rows.flatMap(({ product, variant }) => {
    const raw = counts[variant.id];
    if (raw === undefined || raw.trim() === "" || !variant.trackQuantity) return [];
    const setTo = Number(raw);
    if (!Number.isInteger(setTo) || setTo < 0 || setTo === variant.stockQuantity) return [];
    return [{ productId: product.id, variantId: variant.id, setTo, reason: reason.trim() }];
  });
  const locked = edited.length > 0;
  const totalPages = data?.totalPages ?? 0;

  function runSearch(event: FormEvent) {
    event.preventDefault();
    if (locked) return;
    setPage(1);
    setQuery(search.trim());
  }

  async function saveCounts() {
    if (reason.trim() === "") {
      toast.error("Enter a reason for this change.");
      return;
    }
    setSaving(true);
    try {
      const res = await storeFetch("/api/dashboard/inventory/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: edited }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(refusalMessage(body, "Could not update stock."));
      } else {
        const outcome = body as InventoryAdjustResponse;
        const failedIds = new Set<string>();
        for (const result of outcome.results) {
          if (result.ok) continue;
          failedIds.add(result.variantId);
          const row = rows.find(({ variant }) => variant.id === result.variantId);
          toast.error(`${row?.product.title ?? "A variant"}: ${result.message}`);
        }
        toast.success(`Updated ${outcome.succeeded} of ${outcome.results.length}.`);
        // A refused line keeps what the seller typed, so it can be corrected.
        setCounts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => failedIds.has(id))));
      }
      refetch();
    } catch {
      toast.error("Could not reach the backend. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  /** `variants` in a PATCH is the whole list, so every variant is named and only this one carries a change. */
  async function patchVariant(row: Row, change: { trackQuantity?: boolean; lowStockThreshold?: number | null }) {
    const variants = row.product.variants.map((variant) => (variant.id === row.variant.id ? { id: variant.id, ...change } : { id: variant.id }));
    try {
      const res = await storeFetch(`/api/dashboard/products/${row.product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variants }),
      });
      if (!res.ok) toast.error(refusalMessage(await res.json().catch(() => null)));
      refetch();
    } catch {
      toast.error("Could not reach the backend. Please try again.");
    }
  }

  function saveThreshold(row: Row, raw: string) {
    const value = raw.trim() === "" ? null : Number(raw);
    if (value !== null && (!Number.isInteger(value) || value < 0)) {
      toast.error("The threshold must be a whole number, 0 or more.");
      return;
    }
    if (value !== row.variant.lowStockThreshold) void patchVariant(row, { lowStockThreshold: value });
  }

  const columns: ColumnDef<Row>[] = [
    { header: "Product", render: ({ product }) => product.title },
    { header: "Variant", render: ({ variant }) => variant.title },
    { header: "SKU", render: ({ variant }) => <span className="font-mono text-xs">{variant.sku ?? "—"}</span> },
    {
      header: "Track",
      render: (row) => (
        <Checkbox
          aria-label={`Track quantity of ${row.product.title} ${row.variant.title}`}
          checked={row.variant.trackQuantity}
          onCheckedChange={(checked) => void patchVariant(row, { trackQuantity: checked === true })}
        />
      ),
    },
    {
      header: "Quantity",
      render: ({ variant }) =>
        variant.trackQuantity ? (
          <Input
            type="number"
            min={0}
            step={1}
            className="h-8 w-24 font-mono"
            aria-label={`Quantity of ${variant.title}`}
            value={counts[variant.id] ?? String(variant.stockQuantity)}
            onChange={(e) => setCounts((current) => ({ ...current, [variant.id]: e.target.value }))}
          />
        ) : (
          <span className="text-xs text-muted-foreground">Not tracked</span>
        ),
    },
    {
      header: "Low stock at",
      render: (row) => (
        <Input
          key={`${row.variant.id}-${row.variant.lowStockThreshold ?? ""}`}
          type="number"
          min={0}
          step={1}
          className="h-8 w-20 font-mono"
          aria-label={`Low stock threshold of ${row.variant.title}`}
          defaultValue={row.variant.lowStockThreshold ?? ""}
          disabled={!row.variant.trackQuantity}
          onBlur={(e) => saveThreshold(row, e.target.value)}
        />
      ),
    },
    { header: "Status", render: ({ variant }) => <StatusBadge status={variant.availability} /> },
    {
      header: "",
      render: (row) => (
        <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setHistoryOf(row)}>History</Button>
      ),
    },
  ];

  return (
    <div className="p-6 sm:p-8">
      <PageHeader title="Inventory">
        <RefreshButton />
      </PageHeader>

      <form onSubmit={runSearch} className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          type="search"
          aria-label="Search products"
          placeholder="Search products"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          maxLength={80}
          className="h-9 max-w-xs"
        />
        <Button type="submit" variant="clay-soft" size="sm" disabled={locked}>Search</Button>
        {locked ? <span className="text-xs text-muted-foreground">Save your stock changes before searching or changing page.</span> : null}
      </form>

      {error ? (
        <ErrorState message={error} onRetry={refetch} className="mb-6" />
      ) : loading ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState
          title={query !== "" ? "No matching products" : "No products yet"}
          description={query !== "" ? "Try another search." : "Your inventory will appear here."}
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Input
              aria-label="Reason for this change"
              placeholder="Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              className="h-9 max-w-xs"
            />
            <Button variant="clay" disabled={saving || edited.length === 0} onClick={saveCounts}>
              {saving ? "Saving..." : edited.length > 0 ? `Update ${edited.length} ${edited.length === 1 ? "variant" : "variants"}` : "Update stock"}
            </Button>
          </div>
          <SectionCard noPadding>
            <DataTable data={rows} columns={columns} keyExtractor={({ variant }) => variant.id} />
          </SectionCard>
          {totalPages > 1 ? (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Page {page} of {totalPages}</span>
              <div className="flex gap-2">
                <Button variant="clay-soft" size="sm" disabled={locked || page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button variant="clay-soft" size="sm" disabled={locked || page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          ) : null}
          {historyOf ? (
            <StockHistory key={historyOf.variant.id} row={historyOf} onClose={() => setHistoryOf(null)} />
          ) : null}
        </>
      )}
    </div>
  );
}
