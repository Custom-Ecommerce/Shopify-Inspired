/**
 * Store category helpers for the dashboard. The limits repeat the ones in `@markaz/contracts`: this app imports only
 * types from that package, so the form checks them for a quick message and the backend remains the authority.
 */
export const CATEGORY_NAME_MAX = 80;
export const CATEGORY_SLUG_MAX = 64;
export const CATEGORY_DESCRIPTION_MAX = 500;
const CATEGORY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** What the form says about a slug, or null when it is fine. An empty slug is fine: the backend makes one. */
export function categorySlugError(slug: string): string | null {
  const value = slug.trim();
  if (value === "") return null;
  if (value.length > CATEGORY_SLUG_MAX) return `The slug can be at most ${CATEGORY_SLUG_MAX} characters.`;
  if (!CATEGORY_SLUG_PATTERN.test(value)) return "Use lowercase letters, numbers, and single hyphens.";
  return null;
}

export interface OrderedCategory {
  id: string;
  order?: number | null;
}

export interface CategoryOrderChange {
  id: string;
  order: number;
}

/**
 * The writes that move one category up or down. The list is renumbered from 0 in its new sequence, because categories
 * can share an order value and swapping two equal values would change nothing. Only categories whose number changes
 * are returned, so a list that is already numbered costs two writes.
 */
export function planCategoryMove<T extends OrderedCategory>(
  categories: readonly T[],
  index: number,
  direction: -1 | 1,
): CategoryOrderChange[] {
  const target = index + direction;
  if (index < 0 || index >= categories.length || target < 0 || target >= categories.length) return [];

  const next = [...categories];
  [next[index], next[target]] = [next[target], next[index]];

  return next.flatMap((category, order) => (category.order === order ? [] : [{ id: category.id, order }]));
}
