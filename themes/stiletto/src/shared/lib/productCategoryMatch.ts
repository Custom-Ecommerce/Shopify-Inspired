import type { NormalizedCategory, NormalizedProduct } from "../../types";

const FILLER_WORDS = new Set(["and", "the", "a", "an", "of", "for", "&"]);

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function meaningfulWords(slug: string): string[] {
  return slug
    .split("-")
    .filter((word) => word.length > 0 && !FILLER_WORDS.has(word))
    .map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word));
}

function slugsAreEquivalent(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;

  const wordsA = meaningfulWords(a);
  const wordsB = meaningfulWords(b);

  if (wordsA.length === 0 || wordsB.length === 0) return false;
  if (wordsA.join("-") === wordsB.join("-")) return true;

  const [shorter, longer] =
    wordsA.length <= wordsB.length ? [wordsA, wordsB] : [wordsB, wordsA];
  const longerSet = new Set(longer);

  return shorter.length > 0 && shorter.every((word) => longerSet.has(word));
}

export function productMatchesCategory(
  product: Pick<NormalizedProduct, "tags" | "productType">,
  category: Pick<NormalizedCategory, "handle" | "title">
): boolean {
  const handleSlug = slugify(category.handle || "");
  const titleSlug = slugify(category.title || "");
  const productTypeSlug = slugify(product.productType || "");
  const tagSlugs = (product.tags || []).map((tag) => slugify(tag)).filter(Boolean);

  const matchesAnyTag = (targetSlug: string) =>
    !!targetSlug && tagSlugs.some((tagSlug) => slugsAreEquivalent(tagSlug, targetSlug));

  return (
    matchesAnyTag(handleSlug) ||
    matchesAnyTag(titleSlug) ||
    slugsAreEquivalent(productTypeSlug, titleSlug) ||
    slugsAreEquivalent(productTypeSlug, handleSlug)
  );
}