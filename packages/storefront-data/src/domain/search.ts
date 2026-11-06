import type { StorefrontProductSummary } from "../transport/types";

/** The longest search a shopper can send. Longer input is cut before matching. */
export const MAX_SEARCH_LENGTH = 100;

/** Lowercases, trims and collapses runs of whitespace. The query and the product text both pass through this. */
export function normaliseSearchText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The products that match a query. Every word of the query must appear in the product's title or in one of its
 * category names, in any order and in any case. An empty query matches nothing.
 */
export function searchProductSummaries(
  products: StorefrontProductSummary[],
  query: string,
): StorefrontProductSummary[] {
  const words = normaliseSearchText(query.slice(0, MAX_SEARCH_LENGTH))
    .split(" ")
    .filter((word) => word.length > 0);
  if (words.length === 0) return [];

  return products.filter((product) => {
    const haystack = normaliseSearchText(
      [product.title, ...product.categories.map((category) => category.name)].join(" "),
    );
    return words.every((word) => haystack.includes(word));
  });
}
