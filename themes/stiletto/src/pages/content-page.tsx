"use client";

import type { ContentPageProps } from "@markaz/storefront-data";
import { CollectionHeader } from "../components/collection/CollectionHeader";
import { ContactForm } from "../components/content/ContactForm";
import { ContentBody } from "../components/content/ContentBody";
import { StilettoFooter, StilettoHeader } from "./shell";

/**
 * A static page of the store (about, contact, shipping, returns, privacy, or one the seller wrote). Sprint 7 (S7-B3): the store's own page arrives as the
 * SAFE TREE (`content`) and is rendered as React nodes; default copy (a store with no page of that name) arrives as plain `body` text. Built from the theme's
 * own header, footer and type styles.
 */
export function ContentPage({ title, body, content, slug }: ContentPageProps) {
  return (
    <div className="min-h-screen bg-[var(--featured-bg,#FAF9F6)]">
      <StilettoHeader />

      <main className="relative">
        <CollectionHeader title={title} itemCount={0} />
        <div className="py-12 md:py-16 px-4 md:px-12 max-w-3xl mx-auto w-full" data-source={content ? "live" : "static"} data-source-note="The store's own page when it has one; otherwise default text.">
          {content ? <ContentBody tree={content} /> : <p className="py-12 text-center font-sans text-[15px] text-[var(--featured-card-muted)] break-words">{body}</p>}
          {slug === "contact" ? (<div className="mt-10"><ContactForm /></div>) : null}
        </div>
      </main>

      <StilettoFooter />
    </div>
  );
}
