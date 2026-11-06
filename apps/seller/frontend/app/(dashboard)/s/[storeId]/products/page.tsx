import type { SellerProductSummary } from "@markaz/contracts";
import type { ListEnvelope } from "@markaz/api-compat";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resolveStorePage } from "@/lib/resolve-store-page";
import { storeHref } from "@/lib/store-routes";

import { ProductsTable } from "@/components/dashboard/ProductsTable";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { EmptyState } from "@/components/dashboard/shared/EmptyState";
import { ErrorState } from "@/components/dashboard/shared/ErrorState";

const PAYLOAD_API_URL = process.env.SELLER_BACKEND_API_URL || "http://localhost:4001";
const PAGE_SIZE = 20;
const SELECT_CLASS = "h-9 rounded-md border border-input bg-transparent px-2 text-sm";

type ProductList = ListEnvelope<SellerProductSummary> & { hasDemoProduct: boolean };
type SearchParams = Record<string, string | string[] | undefined>;

const single = (value: string | string[] | undefined): string => (typeof value === "string" ? value : "");

async function fetchProducts(token: string, storeId: string, query: URLSearchParams): Promise<ProductList | null> {
  const res = await fetch(`${PAYLOAD_API_URL}/api/products?${query.toString()}`, {
    headers: { Authorization: `JWT ${token}`, "x-store-id": storeId },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res.json();
}

export default async function DashboardProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { storeId } = await params;
  const resolved = await resolveStorePage(storeId);
  if (!resolved.ok) return resolved.view;
  const { token } = resolved.ctx;

  const search = await searchParams;
  const q = single(search.q);
  const status = single(search.status) || "all";
  const sort = single(search.sort) || "newest";
  const page = Math.max(1, Number.parseInt(single(search.page), 10) || 1);

  const queryFor = (target: number): URLSearchParams =>
    new URLSearchParams({ q, status, sort, page: String(target), limit: String(PAGE_SIZE) });

  const list = await fetchProducts(token, storeId, queryFor(page));
  const products = list?.docs ?? [];
  const totalPages = list?.totalPages ?? 0;
  const pageHref = (target: number): string => `${storeHref(storeId, "/products")}?${queryFor(target).toString()}`;
  const isFiltered = q !== "" || status !== "all";

  return (
    <div className="p-6 sm:p-8">
      <PageHeader title="Products">
        <Button variant="clay-soft" render={<Link href={storeHref(storeId, "/products/import")} />}>Import CSV</Button>
        <Button variant="clay-soft" render={<a href={`/api/dashboard/products/export?storeId=${encodeURIComponent(storeId)}`} />}>Export CSV</Button>
        <Button variant="clay" render={<Link href={storeHref(storeId, "/products/new")} />}>Add Product</Button>
      </PageHeader>

      {list?.hasDemoProduct ? (
        <Alert className="mb-4">
          <AlertDescription>This is a sample product; edit or delete it.</AlertDescription>
        </Alert>
      ) : null}

      <form className="mb-4 flex flex-wrap items-center gap-2">
        <Input name="q" defaultValue={q} placeholder="Search by title" className="max-w-xs" />
        <select name="status" defaultValue={status} aria-label="Status" className={SELECT_CLASS}>
          <option value="all">All</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="trash">Trash</option>
        </select>
        <select name="sort" defaultValue={sort} aria-label="Sort" className={SELECT_CLASS}>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="title">Title</option>
          <option value="price">Price</option>
        </select>
        <Button type="submit" variant="clay-soft">Apply</Button>
      </form>

      {list === null ? (
        <ErrorState message="Could not load your products." />
      ) : products.length === 0 ? (
        <EmptyState
          title={status === "trash" ? "Trash is empty" : isFiltered ? "No matching products" : "No products yet"}
          description={status === "trash" ? "Deleted products wait here for 365 days." : isFiltered ? "Try another search or filter." : "Start adding products to your store."}
        />
      ) : (
        <ProductsTable key={status} products={products} trash={status === "trash"} />
      )}

      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            {page > 1 ? <Button variant="clay-soft" render={<Link href={pageHref(page - 1)} />}>Previous</Button> : null}
            {page < totalPages ? <Button variant="clay-soft" render={<Link href={pageHref(page + 1)} />}>Next</Button> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
