import type { ReactNode } from "react";
import { PageHeader } from "./page-header";

/**
 * Layout for legal pages: readable prose width, one draft notice, consistent
 * headings. The text itself is supplied by each page and is not rewritten here.
 */
export function LegalDocument({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="mx-auto w-full max-w-3xl px-4 pb-(--section-y) sm:px-6 lg:px-8">
        <div role="note" className="mb-10 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm font-medium text-foreground">
          Draft: pending legal review
        </div>
        <div className="space-y-5 text-base leading-relaxed text-muted-foreground [&_h2]:mt-10 [&_h2]:mb-2 [&_h2]:text-h3 [&_h2]:font-semibold [&_h2]:text-foreground">
          {children}
        </div>
      </div>
    </>
  );
}
