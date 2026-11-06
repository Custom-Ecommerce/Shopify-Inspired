import Link from "next/link";
import { storePaths } from "@markaz/storefront-data";
import type { SearchPageProps } from "@markaz/storefront-data";
import { ProductCard } from "../components/product-card";
import { SearchBar } from "../components/search-bar";
import { Card } from "../components/ui/card";
import { countLabel } from "../lib/text";

export function SearchPage({ query, results }: SearchPageProps) {
  const term = query.trim();

  return (
    <main className="mx-auto max-w-6xl px-4 pt-8 pb-16 sm:pt-12">
      <div className="mb-6 flex flex-col gap-4 sm:mb-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {term ? (
              <>
                Results for &ldquo;{term}&rdquo;
              </>
            ) : (
              "Search products"
            )}
          </h1>
          {term && results.length > 0 ? (
            <p className="mt-1.5 text-sm text-(color:--mu-fg-muted)">{countLabel(results.length, "product", "products")}</p>
          ) : null}
        </div>
        <SearchBar defaultValue={term} className="max-w-xl" />
      </div>

      {!term ? (
        <Card className="p-8 text-center text-(color:--mu-fg-muted)">
          <p>Type a product name or a category above to search this store.</p>
        </Card>
      ) : results.length === 0 ? (
        <Card className="p-8 text-center text-(color:--mu-fg-muted)">
          <p className="mb-4">No products matched &ldquo;{term}&rdquo;.</p>
          <Link href={storePaths.catalog} className="font-medium text-(color:--mu-primary) underline-offset-4 hover:underline">
            Browse all products
          </Link>
        </Card>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
          {results.map((product) => (
            <li key={product.id}>
              <ProductCard product={product} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
