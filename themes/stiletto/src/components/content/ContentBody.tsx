import { renderContentTree } from "@markaz/storefront-data";
import type { ArticleVM } from "@markaz/storefront-data";

/**
 * Sprint 7 (S7-B3): an article's or a page's text, rendered from the SAFE TREE as React nodes (React escapes every text; there is no raw HTML and no
 * dangerouslySetInnerHTML). Plain semantic elements with the theme's type styles; everything wraps at 375 px.
 */
const CLASSES = {
  h2: "font-heading text-[26px] md:text-[34px] uppercase leading-tight text-[var(--featured-text)] mt-10 mb-4 break-words",
  h3: "font-heading text-[21px] md:text-[26px] uppercase leading-tight text-[var(--featured-text)] mt-8 mb-3 break-words",
  h4: "font-heading text-[17px] md:text-[20px] uppercase leading-tight text-[var(--featured-text)] mt-6 mb-2 break-words",
  paragraph: "font-sans text-[15px] md:text-[16px] leading-relaxed text-[var(--featured-text)] mb-5 break-words",
  ul: "list-disc pl-6 mb-5 font-sans text-[15px] md:text-[16px] leading-relaxed text-[var(--featured-text)]",
  ol: "list-decimal pl-6 mb-5 font-sans text-[15px] md:text-[16px] leading-relaxed text-[var(--featured-text)]",
  li: "mb-1 break-words",
  link: "underline underline-offset-4 hover:opacity-70 transition-opacity break-words",
  image: "my-6 h-auto max-w-full rounded-lg",
} as const;

export function ContentBody({ tree }: { tree: ArticleVM["content"] }) {
  return <div data-section="content-body">{renderContentTree(tree, CLASSES)}</div>;
}
