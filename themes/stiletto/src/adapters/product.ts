import type { CategoryVM, ProductCardVM, ProductDetailVM } from "@markaz/storefront-data";
import { formatCurrency } from "../shared/lib/services";
import type { NormalizedCategory, NormalizedProduct, NormalizedVariant, ReviewItem } from "../model";
import { PLACEHOLDER_IMAGE } from "./images";
import { paths } from "./paths";

type Source = ProductCardVM | ProductDetailVM;

function isDetail(s: Source): s is ProductDetailVM {
  return "gallery" in s;
}

function moneyString(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Plain text to paragraphs, so an unformatted description keeps its line breaks. */
function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => "<p>" + escapeHtml(p.trim()).replace(/\n/g, "<br/>") + "</p>")
    .join("");
}

/** View-model to the product shape Stiletto's components were built for. Sizes, colours and packs are empty: the SaaS has no variants. */
export function toStilettoProduct(source: Source, reviews: ReviewItem[] = []): NormalizedProduct {
  const detail = isDetail(source) ? source : null;
  const images = detail && detail.gallery.length > 0 ? detail.gallery.map((g) => g.url) : source.image ? [source.image.url] : [PLACEHOLDER_IMAGE];
  const gallery = detail && detail.gallery.length > 0 ? detail.gallery : images.map((url) => ({ url, alt: source.title }));
  const categories = source.categories ?? [];
  const tags = [...new Set([...(detail?.tags ?? []), ...categories.flatMap((c) => [c.name, c.slug])])];
  const variant: NormalizedVariant = {
    id: source.defaultVariantId,
    title: "Default",
    availableForSale: source.canQuickAdd,
    price: { amount: moneyString(source.price.amount), currencyCode: "PKR" },
    compareAtPrice: source.compareAt ? { amount: moneyString(source.compareAt.amount), currencyCode: "PKR" } : null,
    selectedOptions: [],
  };
  const description = detail?.description ?? undefined;
  return {
    id: source.id,
    handle: source.slug,
    title: source.title,
    productType: categories[0]?.name ?? "",
    tags,
    price: formatCurrency(moneyString(source.price.amount), "PKR"),
    images,
    gallery,
    // D-035: until the variant selector, a product with several variants cannot be bought here, so it reads as sold out.
    stockLabel: source.canQuickAdd ? source.stock.label : "Out of stock",
    stockTone: source.canQuickAdd ? "positive" : "negative",
    sizes: [],
    colors: [],
    variantsInfo: "",
    link: paths.product(source.slug),
    descriptionHtml: detail?.descriptionHtml ?? (description ? textToHtml(description) : undefined),
    plainTextDescription: description,
    options: [],
    packOption: null,
    hasPackOption: false,
    variants: [variant],
    metafields: [],
    specs: [],
    reviews,
    previewLabel: source.previewLabel,
  };
}

export function toStilettoCategory(category: CategoryVM): NormalizedCategory {
  return {
    id: category.id,
    title: category.name,
    handle: category.slug,
    image: category.image?.url ?? PLACEHOLDER_IMAGE,
    href: category.href,
  };
}
