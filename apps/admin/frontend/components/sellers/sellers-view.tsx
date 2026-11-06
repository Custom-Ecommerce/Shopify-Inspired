"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { DataTable, TablePagination, type Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listSellers } from "@/lib/api/client";
import type { AdminSellerListItem } from "@/lib/contracts";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useAdminFetch } from "@/lib/hooks/use-admin-fetch";
import { useDebouncedSearch } from "@/lib/hooks/use-debounced-search";
import { parseSellerListState, sellerStateToQuery, type SellerListState } from "@/lib/sellers";

const COLUMNS: Array<Column<AdminSellerListItem>> = [
  {
    key: "seller",
    header: "Seller",
    cell: (seller) => (
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{seller.name}</span>
        <span className="truncate text-xs text-muted-foreground">{seller.email}</span>
      </div>
    ),
  },
  {
    key: "stores",
    header: "Stores",
    cell: (seller) =>
      seller.storeCount === 0 ? (
        <span className="text-muted-foreground">No stores</span>
      ) : (
        <ul className="flex min-w-0 flex-col gap-1" aria-label={"Stores of " + seller.name}>
          {seller.stores.map((store) => (
            <li key={store.id} className="flex min-w-0 items-center gap-2">
              <Link href={"/stores/" + store.id} className="truncate text-primary underline-offset-4 hover:underline">
                {store.name}
              </Link>
              <StatusBadge status={store.status} />
            </li>
          ))}
          {seller.storeCount > seller.stores.length ? <li className="text-xs text-muted-foreground">+{seller.storeCount - seller.stores.length} more</li> : null}
        </ul>
      ),
  },
  {
    key: "joined",
    header: "Joined",
    className: "hidden md:table-cell",
    cell: (seller) => (
      <time dateTime={seller.createdAt} title={formatDateTime(seller.createdAt)} className="text-muted-foreground">
        {formatRelative(seller.createdAt)}
      </time>
    ),
  },
];

/** The seller list at /sellers. Search and page live in the URL, so a view can be shared or reloaded. */
export function SellersView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const state = useMemo(() => parseSellerListState(searchParams), [searchParams]);

  function go(next: SellerListState) {
    const query = sellerStateToQuery(next);
    router.replace(query === "" ? pathname : pathname + "?" + query);
  }

  const [search, setSearch] = useDebouncedSearch(state.q, (q) => go({ ...state, q, page: 1 }));
  const { data, error, loading, refetch } = useAdminFetch((signal) => listSellers(state, signal), [state.page, state.q]);

  useEffect(() => {
    if (data && data.totalPages > 0 && state.page > data.totalPages) go({ ...state, page: data.totalPages });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const filtered = state.q !== "";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h2 className="font-heading mb-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Sellers</h2>
        <p className="text-sm text-muted-foreground">Every seller account on the platform, with the stores they own.</p>
      </div>

      <div className="relative" role="search">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          aria-label="Search sellers"
          placeholder="Search by name, email, or id"
          className="pl-9"
          value={search}
          maxLength={100}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {error && data ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/20 bg-destructive/8 px-5 py-4 text-sm text-foreground">
          <span>{error.message} The figures shown may be out of date.</span>
          <Button variant="outline" size="sm" onClick={refetch}>
            Try again
          </Button>
        </div>
      ) : null}
      <DataTable
        label="Sellers"
        columns={COLUMNS}
        rows={data?.docs ?? []}
        rowKey={(seller) => seller.id}
        loading={loading}
        error={error ? error.message : null}
        onRetry={refetch}
        emptyTitle={filtered ? "No sellers match" : "No sellers yet"}
        emptyHint={filtered ? "Try a different name, email, or id." : "Sellers appear here as they sign up."}
      />

      {data ? <TablePagination page={data.page} totalPages={data.totalPages} totalDocs={data.totalDocs} noun="seller" disabled={loading} onPage={(page) => go({ ...state, page })} /> : null}
    </div>
  );
}
