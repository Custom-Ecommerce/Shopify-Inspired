"use client";

import Link from "next/link";
import type { ArticlePageProps } from "@markaz/storefront-data";
import { storePaths } from "@markaz/storefront-data";
import { ContentBody } from "../components/content/ContentBody";
import { StilettoFooter, StilettoHeader } from "./shell";

/** Sprint 7 (S7-B3): one published article. The text is the safe tree rendered as React nodes; the cover, date and tags come from the store. */
export function ArticlePage({ article }: ArticlePageProps) {
  return (
    <div className="min-h-screen bg-[var(--featured-bg,#FAF9F6)]">
      <StilettoHeader />

      <main className="relative">
        <article data-source="live" className="mx-auto w-full max-w-3xl px-4 md:px-6 pt-30 md:pt-40 pb-16 md:pb-24">
          <Link href={storePaths.blog} className="inline-flex min-h-11 items-center font-sans text-[12px] uppercase tracking-[0.2em] text-[var(--featured-card-muted)] hover:opacity-70">
            Back to the journal
          </Link>

          <header className="mt-4 mb-8">
            {article.dateLabel ? (
              <time dateTime={article.dateIso ?? undefined} className="font-sans text-[12px] uppercase tracking-[0.2em] text-[var(--featured-card-muted)]">
                {article.dateLabel}
              </time>
            ) : null}
            <h1 className="mt-3 font-heading text-[32px] md:text-[52px] uppercase leading-none text-[var(--featured-text)] break-words">{article.title}</h1>
            {article.excerpt ? <p className="mt-5 font-sans text-[16px] leading-relaxed text-[var(--featured-card-muted)] break-words">{article.excerpt}</p> : null}
          </header>

          {article.coverUrl ? (
            <div className="mb-10 aspect-[16/10] w-full overflow-hidden rounded-2xl border border-[var(--separator-border)] bg-black/5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={article.coverUrl} alt="" className="size-full object-cover" />
            </div>
          ) : null}

          <ContentBody tree={article.content} />

          {article.tags.length > 0 ? (
            <ul className="mt-10 flex flex-wrap gap-2" aria-label="Tags">
              {article.tags.map((tag) => (
                <li key={tag} className="rounded-full border border-[var(--separator-border)] px-3 py-1 font-sans text-[12px] text-[var(--featured-card-muted)]">
                  {tag}
                </li>
              ))}
            </ul>
          ) : null}
        </article>
      </main>

      <StilettoFooter />
    </div>
  );
}
