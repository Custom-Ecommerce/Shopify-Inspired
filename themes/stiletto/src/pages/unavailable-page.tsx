"use client";

import Link from "next/link";
import type { UnavailablePageProps } from "@markaz/storefront-data";
import { CollectionHeader } from "../components/collection/CollectionHeader";
import { paths } from "../adapters/paths";
import { StilettoFooter, StilettoHeader } from "./shell";

/** New UI: the original design has no error state. Shown when the store's data cannot be loaded. */
export function UnavailablePage({ message, retryHref, onRetry }: UnavailablePageProps) {
  const text = message ?? "Something went wrong while loading this page. Please try again.";
  return (
    <div className="min-h-screen bg-[var(--featured-bg,#FAF9F6)]">
      <StilettoHeader />

      <main className="relative" data-source="static" data-source-note="Static unavailable page (new UI, not in the original design).">
        <CollectionHeader title="Temporarily Unavailable" description={text} itemCount={0} />
        <div className="py-12 md:py-16 px-4 md:px-12 max-w-container-max mx-auto w-full">
          {onRetry ? (
            <button type="button" onClick={onRetry} className="inline-flex items-center gap-2 font-sans text-[12px] uppercase tracking-[0.15em] font-medium text-[var(--featured-text)] border-b border-[var(--featured-text)] pb-4 hover:opacity-60 transition-opacity">
              Try again
            </button>
          ) : (
            <Link href={retryHref ?? paths.home} className="inline-flex items-center gap-2 font-sans text-[12px] uppercase tracking-[0.15em] font-medium text-[var(--featured-text)] border-b border-[var(--featured-text)] pb-4 hover:opacity-60 transition-opacity">
              {retryHref ? "Try again" : "Back to store"}
            </Link>
          )}
        </div>
      </main>

      <StilettoFooter />
    </div>
  );
}
