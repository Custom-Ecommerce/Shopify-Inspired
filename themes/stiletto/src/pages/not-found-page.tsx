"use client";

import type { NotFoundPageProps } from "@markaz/storefront-data";
import { CollectionHeader } from "../components/collection/CollectionHeader";
import { StilettoFooter, StilettoHeader } from "./shell";

/** New UI: the original design has no 404 page. */
export function NotFoundPage(_props: NotFoundPageProps) {
  return (
    <div className="min-h-screen bg-[var(--featured-bg,#FAF9F6)]">
      <StilettoHeader />

      <main className="relative" data-source="static" data-source-note="Static not-found page (new UI, not in the original design).">
        <CollectionHeader title="Page Not Found" description="We could not find what you were looking for." itemCount={0} />
      </main>

      <StilettoFooter />
    </div>
  );
}
