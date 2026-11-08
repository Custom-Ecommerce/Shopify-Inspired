"use client";

import * as React from "react";
import Link from "next/link";
import type { CatalogPageProps } from "@markaz/storefront-data";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { ProductCard } from "../components/product-card";
import { IconSearch } from "../components/ui/icons";

export function CatalogPage(props: CatalogPageProps) {
  const store = (props as any).store;
  const storePaths = (props as any).storePaths ?? (props as any).paths ?? {};

  const rawProducts = props.data.status === "ok" ? props.data.products : [];

  const rawCategories: any[] =
    (props as any).categories ?? (props as any).catalog?.categories ?? [];
  const activeCategory: string | undefined = (props as any).activeCategory;

  const [filterQuery, setFilterQuery] = React.useState("");
  const [selectedCategory, setSelectedCategory] = React.useState<string>(
    activeCategory ?? "all"
  );
  const [inStockOnly, setInStockOnly] = React.useState(false);
  const [sortBy, setSortBy] = React.useState<
    "featured" | "price-asc" | "price-desc" | "title"
  >("featured");

  const filteredProducts = React.useMemo(() => {
    const list = rawProducts.filter((product: any) => {
      const matchesCategory =
        selectedCategory === "all" ||
        product.categorySlug === selectedCategory ||
        product.categoryId === selectedCategory ||
        product.category?.slug === selectedCategory ||
        product.categoryName?.toLowerCase() === selectedCategory.toLowerCase();

      const matchesSearch =
        !filterQuery.trim() ||
        (product.title ?? "")
          .toLowerCase()
          .includes(filterQuery.trim().toLowerCase()) ||
        (product.description &&
          product.description
            .toLowerCase()
            .includes(filterQuery.trim().toLowerCase()));

      const isOut =
        product.inStock === false ||
        product.stockStatus === "out_of_stock" ||
        product.stockStatus === "OUT_OF_STOCK" ||
        (typeof product.stockQuantity === "number" &&
          product.stockQuantity <= 0);

      const matchesStock = !inStockOnly || !isOut;

      return matchesCategory && matchesSearch && matchesStock;
    });

    if (sortBy === "price-asc") {
      return [...list].sort(
        (a, b) => Number(a.price ?? 0) - Number(b.price ?? 0)
      );
    }
    if (sortBy === "price-desc") {
      return [...list].sort(
        (a, b) => Number(b.price ?? 0) - Number(a.price ?? 0)
      );
    }
    if (sortBy === "title") {
      return [...list].sort((a, b) =>
        String(a.title ?? "").localeCompare(String(b.title ?? ""))
      );
    }
    return list;
  }, [rawProducts, selectedCategory, filterQuery, inStockOnly, sortBy]);

  const hasActiveFilters =
    Boolean(filterQuery.trim()) || selectedCategory !== "all" || inStockOnly;

  return (
    <div className="flex flex-col gap-8 font-[family-name:var(--mu-font-family-stack)]">
      {/* Breadcrumb & Collection Header (design.md §3.4) */}
      <div className="flex flex-col gap-3 border-b border-[var(--mu-color-line)] pb-6">
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-2 text-[length:var(--mu-text-xs)] text-[var(--mu-color-ink-muted)]"
        >
          <Link
            href={storePaths.home ?? "/"}
            className="hover:text-[var(--mu-color-ink)]"
          >
            Home
          </Link>
          <span aria-hidden="true">/</span>
          <span className="text-[var(--mu-color-ink)] font-medium">
            Collections
          </span>
        </nav>

        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-[length:var(--mu-text-h1)] font-normal tracking-[-0.01em] text-[var(--mu-color-ink)] leading-tight">
              All Fresh Products
            </h1>
            <p className="mt-1 text-[length:var(--mu-text-body)] text-[var(--mu-color-ink-soft)]">
              Locally sourced groceries, artisan baked goods, and organic essentials from{" "}
              {store?.name ?? "Local"}.
            </p>
          </div>

          {/* Sort Pill & Count Toolbar */}
          <div className="flex items-center gap-3">
            <span
              aria-live="polite"
              className="text-[length:var(--mu-text-small)] text-[var(--mu-color-ink-muted)] whitespace-nowrap"
            >
              {filteredProducts.length}{" "}
              {filteredProducts.length === 1 ? "product" : "products"}
            </span>

            <label htmlFor="mu-catalog-sort" className="sr-only">
              Sort products
            </label>
            <select
              id="mu-catalog-sort"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="h-11 rounded-[var(--mu-radius-pill)] border border-[var(--mu-color-line)] bg-[var(--mu-color-surface)] px-4 text-[length:var(--mu-text-small)] text-[var(--mu-color-ink)] focus-visible:outline-2 focus-visible:outline-[var(--mu-color-focus)] cursor-pointer"
            >
              <option value="featured">Sort by: Featured</option>
              <option value="price-asc">Price: Low to High</option>
              <option value="price-desc">Price: High to Low</option>
              <option value="title">Alphabetically: A–Z</option>
            </select>
          </div>
        </div>
      </div>

      {/* Desktop 2-Column Layout: 260px Sticky Filter Sidebar + Product Grid (design.md §3.4) */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[260px_1fr] lg:items-start">
        {/* Left Sticky Filter Sidebar */}
        <aside
          aria-label="Catalog filters"
          className="lg:sticky lg:top-20 flex flex-col gap-6 rounded-[var(--mu-radius-card)] border border-[var(--mu-color-line)] bg-[var(--mu-color-surface)] p-5"
        >
          {/* Search Filter */}
          <div className="flex flex-col gap-2">
            <label
              htmlFor="mu-catalog-search"
              className="text-[length:var(--mu-text-small)] font-medium text-[var(--mu-color-ink)]"
            >
              Search keyword
            </label>
            <div className="relative">
              <Input
                id="mu-catalog-search"
                type="search"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="Search products..."
                className="pl-10"
              />
              <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--mu-color-ink-muted)]" />
            </div>
          </div>

          {/* Availability Filter */}
          <div className="flex flex-col gap-2.5 border-t border-[var(--mu-color-line)] pt-4">
            <h2 className="text-[length:var(--mu-text-small)] font-medium text-[var(--mu-color-ink)]">
              Availability
            </h2>
            <label className="inline-flex items-center gap-2.5 text-[length:var(--mu-text-small)] text-[var(--mu-color-ink-soft)] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={inStockOnly}
                onChange={(e) => setInStockOnly(e.target.checked)}
                className="h-4 w-4 rounded border-[var(--mu-color-line-strong)] accent-[var(--mu-color-ink)]"
              />
              <span>In stock only</span>
            </label>
          </div>

          {/* Category Filter Chips */}
          <div className="flex flex-col gap-2.5 border-t border-[var(--mu-color-line)] pt-4">
            <h2 className="text-[length:var(--mu-text-small)] font-medium text-[var(--mu-color-ink)]">
              Categories
            </h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedCategory("all")}
                className={`h-9 rounded-[var(--mu-radius-pill)] px-4 text-[length:var(--mu-text-xs)] font-medium border transition-colors cursor-pointer ${
                  selectedCategory === "all"
                    ? "border-[var(--mu-color-line-strong)] bg-[var(--mu-color-ink)] text-white"
                    : "border-[var(--mu-color-line)] bg-[var(--mu-color-surface)] text-[var(--mu-color-ink)] hover:border-[var(--mu-color-line-strong)]"
                }`}
              >
                All ({rawProducts.length})
              </button>
              {rawCategories.map((cat: any) => {
                const key = cat.slug || cat.id || cat.name;
                const active = selectedCategory === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedCategory(key)}
                    className={`h-9 rounded-[var(--mu-radius-pill)] px-4 text-[length:var(--mu-text-xs)] font-medium border transition-colors cursor-pointer ${
                      active
                        ? "border-[var(--mu-color-line-strong)] bg-[var(--mu-color-ink)] text-white"
                        : "border-[var(--mu-color-line)] bg-[var(--mu-color-surface)] text-[var(--mu-color-ink)] hover:border-[var(--mu-color-line-strong)]"
                    }`}
                  >
                    {cat.name ?? cat.title}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Nutri-Score Reference Bar */}
          <div className="flex flex-col gap-2 border-t border-[var(--mu-color-line)] pt-4">
            <span className="text-[length:var(--mu-text-xs)] font-medium uppercase tracking-wider text-[var(--mu-color-ink-muted)]">
              Nutri-Score Quality
            </span>
            <div className="grid grid-cols-5 overflow-hidden rounded-[var(--mu-radius-sm)] text-center text-xs font-bold text-white">
              <span className="bg-[var(--mu-color-nutri-a)] py-1">A</span>
              <span className="bg-[var(--mu-color-nutri-b)] py-1">B</span>
              <span className="bg-[var(--mu-color-nutri-c)] py-1 text-[var(--mu-color-ink)]">
                C
              </span>
              <span className="bg-[var(--mu-color-nutri-d)] py-1">D</span>
              <span className="bg-[var(--mu-color-nutri-e)] py-1">E</span>
            </div>
          </div>

          {hasActiveFilters && (
            <Button
              variant="outline"
              size="sm"
              fullWidth
              onClick={() => {
                setFilterQuery("");
                setSelectedCategory("all");
                setInStockOnly(false);
              }}
            >
              Clear all filters
            </Button>
          )}
        </aside>

        {/* Right Product Grid Area */}
        <div className="flex flex-col gap-5">
          {/* Removable Active Filter Pills */}
          {hasActiveFilters && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[length:var(--mu-text-xs)] text-[var(--mu-color-ink-muted)]">
                Active filters:
              </span>
              {selectedCategory !== "all" && (
                <Badge tone="secondary" className="gap-1.5">
                  <span>Category: {selectedCategory}</span>
                  <button
                    type="button"
                    onClick={() => setSelectedCategory("all")}
                    aria-label="Remove category filter"
                    className="ml-1 font-bold hover:text-[var(--mu-color-sale)] cursor-pointer"
                  >
                    &times;
                  </button>
                </Badge>
              )}
              {inStockOnly && (
                <Badge tone="secondary" className="gap-1.5">
                  <span>In Stock Only</span>
                  <button
                    type="button"
                    onClick={() => setInStockOnly(false)}
                    aria-label="Remove in-stock filter"
                    className="ml-1 font-bold hover:text-[var(--mu-color-sale)] cursor-pointer"
                  >
                    &times;
                  </button>
                </Badge>
              )}
              {filterQuery.trim() && (
                <Badge tone="secondary" className="gap-1.5">
                  <span>&ldquo;{filterQuery.trim()}&rdquo;</span>
                  <button
                    type="button"
                    onClick={() => setFilterQuery("")}
                    aria-label="Clear search query"
                    className="ml-1 font-bold hover:text-[var(--mu-color-sale)] cursor-pointer"
                  >
                    &times;
                  </button>
                </Badge>
              )}
            </div>
          )}

          {filteredProducts.length === 0 ? (
            <Card
              variant="muted"
              padding="lg"
              className="flex flex-col items-center justify-center text-center gap-4 py-16"
            >
              <Badge tone="neutral">0 Results</Badge>
              <h2 className="text-[length:var(--mu-text-h3)] font-medium text-[var(--mu-color-ink)]">
                No products match your selected filters
              </h2>
              <p className="text-[length:var(--mu-text-small)] text-[var(--mu-color-ink-muted)] max-w-md">
                Try clearing your search keyword or resetting availability filters.
              </p>
              <Button
                variant="outline"
                size="md"
                onClick={() => {
                  setFilterQuery("");
                  setSelectedCategory("all");
                  setInStockOnly(false);
                }}
              >
                Clear filters
              </Button>
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4 lg:gap-6">
              {filteredProducts.map((product: any) => (
                <ProductCard
                  key={product.id ?? product.slug}
                  product={product}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const MustafaCatalogPage = CatalogPage;
export default CatalogPage;
