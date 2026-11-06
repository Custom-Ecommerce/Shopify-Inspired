"use client";

import type { ContentPageProps } from "@markaz/storefront-data";
import { CollectionHeader } from "../components/collection/CollectionHeader";
import { StilettoFooter, StilettoHeader } from "./shell";

/** New UI: the original design has no About or Contact page. Built from the theme's own header, footer and type styles. */
export function ContentPage({ title, body }: ContentPageProps) {
  return (
    <div className="min-h-screen bg-[var(--featured-bg,#FAF9F6)]">
      <StilettoHeader />

      <main className="relative">
        <CollectionHeader title={title} itemCount={0} />
        <div className="py-12 md:py-16 px-4 md:px-12 max-w-container-max mx-auto w-full" data-source="static" data-source-note="Content pages are static text; sellers cannot edit them yet.">
          <p className="py-12 text-center font-sans text-[15px] text-[var(--featured-card-muted)]">{body}</p>
        </div>
      </main>

      <StilettoFooter />
    </div>
  );
}
