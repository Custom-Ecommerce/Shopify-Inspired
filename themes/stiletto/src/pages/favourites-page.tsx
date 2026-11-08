"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useFavouriteProducts } from "@markaz/storefront-data/client";
import { CollectionHeader } from "../components/collection/CollectionHeader";
import { paths } from "../adapters/paths";
import { toStilettoProduct } from "../adapters/product";
import { ProductCard } from "../shared/components/product/ProductCard";
import { StilettoFooter, StilettoHeader } from "./shell";

function Message({ text, linkToProducts }: { text: string; linkToProducts?: boolean }) {
  return (
    <div className="py-16 text-center">
      <p className="font-sans text-[14px] text-[var(--featured-card-muted)]">{text}</p>
      {linkToProducts ? (
        <Link href={paths.catalog} className="mt-3 inline-block font-sans text-[13px] underline underline-offset-4 text-[var(--featured-text)]">
          Browse products
        </Link>
      ) : null}
    </div>
  );
}

/** The shopper's saved products, as normal cards. Everything about the list comes from the data layer. */
export function FavouritesPage() {
  const { status, products } = useFavouriteProducts();
  const cards = useMemo(() => products.map((product) => toStilettoProduct(product)), [products]);

  return (
    <div className="min-h-screen bg-[var(--featured-bg,#FAF9F6)]">
      <StilettoHeader />

      <main className="relative pt-20 md:pt-0">
        <CollectionHeader title="Favourites" description="The products you saved on this device." itemCount={cards.length} />

        <div className="py-12 md:py-16 px-4 md:px-12 max-w-container-max mx-auto w-full">
          {cards.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
              {cards.map((product, index) => (
                <ProductCard key={product.id} product={product} index={index} variant="featured" fill />
              ))}
            </div>
          ) : status === "unavailable" ? (
            <Message text="We could not load your favourites just now. Please try again in a moment." />
          ) : status === "ok" ? (
            <Message text="You have no favourites yet. Tap the heart on a product to save it here." linkToProducts />
          ) : (
            <Message text="Loading your favourites..." />
          )}
        </div>
      </main>

      <StilettoFooter />
    </div>
  );
}
