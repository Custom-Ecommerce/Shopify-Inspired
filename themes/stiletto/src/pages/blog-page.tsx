"use client";

import Link from "next/link";
import type { BlogPageProps } from "@markaz/storefront-data";
import { storePaths } from "@markaz/storefront-data";
import { StilettoFooter, StilettoHeader } from "./shell";

/** Sprint 7 (S7-B3): the store's blog. New UI built from the theme's own header, footer and type styles; the articles are the store's published ones. */
export function BlogPage({ articles, page, totalPages }: BlogPageProps) {
  const pageHref = (n: number) => (n <= 1 ? storePaths.blog : storePaths.blog + "?page=" + n);
  return (
    <div className="min-h-screen bg-[var(--featured-bg,#FAF9F6)]">
      <StilettoHeader />

      <main className="relative">
        <div className="w-full border-b border-[var(--separator-border)] pt-30 md:pt-40 pb-10 px-4 md:px-12">
          <div className="max-w-container-max mx-auto">
            <h1 className="font-heading text-[36px] md:text-[56px] uppercase leading-none text-[var(--featured-text)]">Journal</h1>
            <p className="mt-4 font-sans text-[14px] md:text-[15px] text-[var(--featured-card-muted)]">News, guides and stories from the store.</p>
          </div>
        </div>

        <div data-source="live" className="max-w-container-max mx-auto w-full px-4 md:px-12 py-10 md:py-16">
          {articles.length === 0 ? (
            <p className="py-16 text-center font-sans text-[15px] text-[var(--featured-card-muted)]">No articles yet. Please check back soon.</p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-12">
              {articles.map((article) => (
                <li key={article.id} className="min-w-0">
                  <Link href={article.href} className="group flex flex-col gap-4">
                    {article.coverUrl ? (
                      <span className="block aspect-[4/3] w-full overflow-hidden rounded-2xl border border-[var(--separator-border)] bg-black/5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={article.coverUrl} alt="" loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover:scale-105" />
                      </span>
                    ) : null}
                    <span className="flex flex-col gap-2">
                      {article.dateLabel ? (
                        <time dateTime={article.dateIso ?? undefined} className="font-sans text-[12px] uppercase tracking-[0.2em] text-[var(--featured-card-muted)]">
                          {article.dateLabel}
                        </time>
                      ) : null}
                      <span className="font-heading text-[22px] md:text-[26px] uppercase leading-tight text-[var(--featured-text)] break-words">{article.title}</span>
                      {article.excerpt ? <span className="font-sans text-[14px] leading-relaxed text-[var(--featured-card-muted)] break-words">{article.excerpt}</span> : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {totalPages > 1 ? (
            <nav aria-label="Blog pages" className="mt-14 flex items-center justify-between gap-4 font-sans text-[13px] uppercase tracking-widest">
              {page > 1 ? (
                <Link href={pageHref(page - 1)} className="inline-flex min-h-11 items-center underline underline-offset-4">Newer</Link>
              ) : (
                <span />
              )}
              <span className="text-[var(--featured-card-muted)]">Page {page} of {totalPages}</span>
              {page < totalPages ? (
                <Link href={pageHref(page + 1)} className="inline-flex min-h-11 items-center underline underline-offset-4">Older</Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </div>
      </main>

      <StilettoFooter />
    </div>
  );
}
