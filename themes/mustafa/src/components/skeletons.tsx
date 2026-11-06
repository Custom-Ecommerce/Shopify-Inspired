import type { ReactNode } from "react";
import { Skeleton } from "./ui/skeleton";

/**
 * Wraps placeholder blocks in a polite status region, so a screen reader announces the loading state once
 * instead of reading every block.
 */
function LoadingRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-(--mu-radius-lg) border border-(--mu-border) bg-(--mu-surface)">
      <Skeleton className="aspect-4/5 w-full" />
      <div className="flex flex-col gap-2.5 p-3.5 sm:p-4">
        <Skeleton className="h-4 w-4/5 rounded-(--mu-radius)" />
        <Skeleton className="h-4 w-2/5 rounded-(--mu-radius)" />
      </div>
    </div>
  );
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <LoadingRegion label="Loading products">
      <div className="grid grid-cols-2 gap-3 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: count }, (_, index) => (
          <ProductCardSkeleton key={index} />
        ))}
      </div>
    </LoadingRegion>
  );
}

export function ProductDetailSkeleton() {
  return (
    <LoadingRegion label="Loading product">
      <div className="grid gap-8 md:grid-cols-2 md:gap-12 lg:gap-16">
        <Skeleton className="aspect-square w-full rounded-(--mu-radius-lg)" />
        <div className="flex flex-col gap-5">
          <Skeleton className="h-9 w-3/4 rounded-(--mu-radius)" />
          <Skeleton className="h-7 w-1/3 rounded-(--mu-radius)" />
          <Skeleton className="h-6 w-1/4 rounded-full" />
          <Skeleton className="h-11 w-full rounded-(--mu-radius) sm:w-56" />
          <div className="flex flex-col gap-2.5 pt-2">
            <Skeleton className="h-4 w-full rounded-(--mu-radius)" />
            <Skeleton className="h-4 w-11/12 rounded-(--mu-radius)" />
            <Skeleton className="h-4 w-2/3 rounded-(--mu-radius)" />
          </div>
        </div>
      </div>
    </LoadingRegion>
  );
}

export function CartSkeleton() {
  return (
    <LoadingRegion label="Loading your cart">
      <Skeleton className="mb-6 h-9 w-32 rounded-(--mu-radius) sm:mb-8" />
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_20rem] md:gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="overflow-hidden rounded-(--mu-radius-lg) border border-(--mu-border) bg-(--mu-surface)">
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex gap-4 border-b border-(--mu-border) p-4 last:border-b-0 sm:p-5">
              <Skeleton className="size-20 shrink-0 rounded-(--mu-radius) sm:size-24" />
              <div className="flex flex-1 flex-col gap-2.5 pt-1">
                <Skeleton className="h-4 w-3/5 rounded-(--mu-radius)" />
                <Skeleton className="h-4 w-1/3 rounded-(--mu-radius)" />
                <Skeleton className="mt-auto h-4 w-1/4 rounded-(--mu-radius)" />
              </div>
            </div>
          ))}
        </div>
        <div className="h-64 rounded-(--mu-radius-lg) border border-(--mu-border) bg-(--mu-surface) p-5">
          <Skeleton className="h-full w-full rounded-(--mu-radius)" />
        </div>
      </div>
    </LoadingRegion>
  );
}

export function CheckoutSkeleton() {
  return (
    <LoadingRegion label="Loading checkout">
      <Skeleton className="mb-6 h-9 w-40 rounded-(--mu-radius) sm:mb-8" />
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_21rem] md:gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-5 rounded-(--mu-radius-lg) border border-(--mu-border) bg-(--mu-surface) p-5 sm:p-6">
          <Skeleton className="h-6 w-40 rounded-(--mu-radius)" />
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex flex-col gap-2">
              <Skeleton className="h-4 w-28 rounded-(--mu-radius)" />
              <Skeleton
                className={index === 2 ? "h-24 w-full rounded-(--mu-radius)" : "h-11 w-full rounded-(--mu-radius)"}
              />
            </div>
          ))}
          <Skeleton className="h-12 w-full rounded-(--mu-radius)" />
        </div>
        <div className="h-72 rounded-(--mu-radius-lg) border border-(--mu-border) bg-(--mu-surface) p-5">
          <Skeleton className="h-full w-full rounded-(--mu-radius)" />
        </div>
      </div>
    </LoadingRegion>
  );
}
