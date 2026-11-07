"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { ModerationDialog } from "@/components/products/moderation-dialog";
import { DataTable, TablePagination, type Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { listModerationProducts } from "@/lib/api/client";
import type { ModerationProduct } from "@/lib/contracts";
import { formatRelative } from "@/lib/format";
import { useAdminFetch } from "@/lib/hooks/use-admin-fetch";
import {
  MODERATION_COPY,
  PRODUCT_STATUS_VALUES,
  availableModerationActions,
  parseProductListState,
  productStateToQuery,
  type ModerationAction,
  type ProductListState,
} from "@/lib/products";
import { statusLabel } from "@/lib/status";

const SEARCH_DELAY_MS = 300;

/** The cross-store product list at /products. Filters and page live in the URL, so a view can be shared or reloaded. */
export function ProductsView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const state = useMemo(() => parseProductListState(searchParams), [searchParams]);
  const [search, setSearch] = useState(state.q);
  const [intent, setIntent] = useState<{ action: ModerationAction; product: ModerationProduct } | null>(null);
  const latest = useRef(state);
  latest.current = state;

  function go(next: ProductListState) {
    const query = productStateToQuery(next);
    router.replace(query === "" ? pathname : pathname + "?" + query);
  }

  useEffect(() => {
    if (search.trim() === state.q) return;
    const timer = setTimeout(() => go({ ...latest.current, q: search.trim(), page: 1 }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const { data, error, loading, refetch } = useAdminFetch(
    (signal) => listModerationProducts(state, signal),
    [state.page, state.q, state.status, state.storeId],
  );

  useEffect(() => {
    if (data && data.totalPages > 0 && state.page > data.totalPages) go({ ...state, page: data.totalPages });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const columns: Array<Column<ModerationProduct>> = [
    {
      key: "product",
      header: "Product",
      cell: (product) => (
        // max-w-xs: truncate only shortens text inside a bounded box. Unbounded, a long title widened the table at about
        // 1024 px until the "Delete permanently" action was pushed out of view.
        <div className="flex min-w-0 max-w-xs flex-col">
          <span className="truncate font-medium">{product.title}</span>
          <span className="truncate text-xs text-muted-foreground">{product.slug}</span>
        </div>
      ),
    },
    {
      key: "store",
      header: "Store",
      className: "hidden md:table-cell",
      cell: (product) => (
        <button type="button" className="truncate text-left text-primary underline-offset-4 hover:underline" onClick={() => go({ ...state, storeId: product.storeId, page: 1 })}>
          {product.storeName ?? product.storeId}
        </button>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (product) => (
        <div className="flex min-w-0 flex-col gap-1">
          <StatusBadge status={product.status} label={product.adminDeleted ? "Deleted by admin" : undefined} />
          {product.takedownReason ?? product.deleteReason ? (
            <span className="text-xs text-muted-foreground">{product.takedownReason ?? product.deleteReason}</span>
          ) : null}
        </div>
      ),
    },
    { key: "updated", header: "Updated", className: "hidden lg:table-cell", cell: (product) => <span className="text-muted-foreground">{formatRelative(product.updatedAt)}</span> },
    {
      key: "actions",
      header: "Actions",
      cell: (product) => (
        <div className="flex flex-wrap gap-1">
          {availableModerationActions(product).map((action) => (
            <Button key={action} variant="outline" size="sm" onClick={() => setIntent({ action, product })}>
              {MODERATION_COPY[action].button}
            </Button>
          ))}
        </div>
      ),
    },
  ];

  const filtered = state.q !== "" || state.status !== "" || state.storeId !== "";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h2 className="font-heading mb-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Products</h2>
        <p className="text-sm text-muted-foreground">Every product on the platform. You can take one down, delete it, or restore it, but not edit it.</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row" role="search">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            aria-label="Search products"
            placeholder="Search by title"
            className="pl-9"
            value={search}
            maxLength={80}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Select
          aria-label="Filter by status"
          className="sm:w-48"
          value={state.status}
          onChange={(event) => go({ ...state, status: event.target.value as ProductListState["status"], page: 1 })}
        >
          <option value="">All statuses</option>
          {PRODUCT_STATUS_VALUES.map((status) => (
            <option key={status} value={status}>
              {statusLabel(status)}
            </option>
          ))}
        </Select>
        {state.storeId !== "" ? (
          <Button variant="outline" onClick={() => go({ ...state, storeId: "", page: 1 })}>
            All stores
          </Button>
        ) : null}
      </div>

      {error && data ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/20 bg-destructive/8 px-5 py-4 text-sm text-foreground">
          <span>{error.message} The list shown may be out of date.</span>
          <Button variant="outline" size="sm" onClick={refetch}>
            Try again
          </Button>
        </div>
      ) : null}
      <DataTable
        label="Products"
        columns={columns}
        rows={data?.docs ?? []}
        rowKey={(product) => product.productId}
        loading={loading}
        error={error ? error.message : null}
        onRetry={refetch}
        emptyTitle={filtered ? "No products match" : "No products yet"}
        emptyHint={filtered ? "Try a different search or clear the filters." : "Products appear here as sellers create them."}
      />

      {data ? (
        <TablePagination page={data.page} totalPages={data.totalPages} totalDocs={data.totalDocs} noun="product" disabled={loading} onPage={(page) => go({ ...state, page })} />
      ) : null}

      {intent !== null ? (
        <ModerationDialog
          key={intent.action + intent.product.productId}
          action={intent.action}
          product={intent.product}
          onClose={() => setIntent(null)}
          onDone={() => {
            setIntent(null);
            refetch();
          }}
        />
      ) : null}
    </div>
  );
}
