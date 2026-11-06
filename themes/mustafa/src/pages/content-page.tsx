import Link from "next/link";
import { storePaths } from "@markaz/storefront-data";
import type { ContentPageProps } from "@markaz/storefront-data";

/** A store article or policy page. The body keeps its line breaks, and the reading width stays comfortable. */
export function ContentPage({ title, body }: ContentPageProps) {
  return (
    <main className="mx-auto max-w-3xl px-4 pt-8 pb-16 sm:pt-12">
      <h1 className="mb-6 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h1>
      <div className="text-base leading-relaxed whitespace-pre-line text-(color:--mu-fg)">{body}</div>
      <p className="mt-10 border-t border-(--mu-border) pt-6">
        <Link
          href={storePaths.catalog}
          className="font-medium text-(color:--mu-primary) underline-offset-4 hover:underline"
        >
          Back to products
        </Link>
      </p>
    </main>
  );
}
