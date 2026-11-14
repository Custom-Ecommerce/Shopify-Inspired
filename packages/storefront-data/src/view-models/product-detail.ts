import { discountPercent } from "@markaz/platform-kit/commerce";
import { toMoney } from "../domain/money";
import type { Money } from "../domain/money";
import type { StockStatus, StorefrontProductDetail, StorefrontProductOption, StorefrontProductVariant } from "../transport/types";
import { initialSelection, resolveVariant, selectableOptions } from "../domain/variants";
import type { SelectableOption, SelectedOptions } from "../domain/variants";
import { STOCK_LABELS, toProductCardVM } from "./product-card";
import type { ProductCardVM } from "./product-card";

export interface ProductVariantVM {
  id: string;
  title: string;
  price: Money;
  compareAt: Money | null;
  discountPercent: number;
  availability: StockStatus;
  /** Units left, only when there are few. */
  onlyLeft: number | null;
  optionValues: string[];
  imageId: string | null;
}

function toVariantVM(variant: StorefrontProductVariant): ProductVariantVM {
  return {
    id: variant.id,
    title: variant.title,
    price: toMoney(variant.price),
    compareAt: variant.compareAtPrice === null ? null : toMoney(variant.compareAtPrice),
    discountPercent: discountPercent(variant.price, variant.compareAtPrice),
    availability: variant.availability,
    onlyLeft: variant.onlyLeft ?? null,
    optionValues: [...variant.optionValues],
    imageId: variant.imageId,
  };
}

export interface ProductVideoVM {
  id: string;
  url: string;
  posterUrl: string | null;
  /** Seconds. */
  duration: number | null;
}

export interface ProductDetailVM extends ProductCardVM {
  options: StorefrontProductOption[];
  variants: ProductVariantVM[];
  description: string | null;
  highlights: string[];
  /** id is null only for fixtures, which link no variant to an image. */
  gallery: { id: string | null; url: string; alt: string }[];
  /** What a search result shows: the seller's SEO fields, else the title, the start of the description and the first image. */
  seo: { title: string; description: string | null; imageUrl: string | null };
  /** Kept apart from the gallery: a variant only ever points at an image. */
  videos: ProductVideoVM[];
  /** The cheapest and dearest variant. */
  priceRange: { min: Money; max: Money };
  deliveryFee: Money;
  deliveryLabel: string;
  canAddToCart: boolean;
  /** Rich description when the backend sends one. */
  descriptionHtml?: string | null;
  tags?: string[];
}

const SEO_DESCRIPTION_MAX = 160;

function fallbackDescription(description: string | null): string | null {
  const text = (description ?? "").replace(/\s+/g, " ").trim().slice(0, SEO_DESCRIPTION_MAX).trim();
  return text === "" ? null : text;
}

export function toProductDetailVM(dto: StorefrontProductDetail): ProductDetailVM {
  const deliveryFee = toMoney(dto.deliveryCharge);
  const prices = dto.variants.map((variant) => variant.price);
  const card = toProductCardVM(dto);
  return {
    ...card,
    options: dto.options.map((option) => ({ name: option.name, values: [...option.values] })),
    variants: dto.variants.map(toVariantVM),
    description: dto.description,
    highlights: [...dto.highlights],
    gallery: dto.images.map((image) => ({ id: image.id ?? null, url: image.url, alt: image.alt })),
    seo: {
      title: dto.seo.title || dto.title,
      description: dto.seo.description || fallbackDescription(dto.description),
      imageUrl: dto.seo.imageUrl || dto.images[0]?.url || null,
    },
    videos: (dto.videos ?? []).map((video) => ({ id: video.id, url: video.url, posterUrl: video.posterUrl, duration: video.duration })),
    priceRange: { min: toMoney(Math.min(dto.price, ...prices)), max: toMoney(Math.max(dto.price, ...prices)) },
    deliveryFee,
    deliveryLabel: dto.deliveryCharge === 0 ? "Free delivery" : "Delivery " + deliveryFee.formatted,
    canAddToCart: card.canQuickAdd,
    descriptionHtml: dto.descriptionHtml ?? null,
    tags: [...dto.tags],
  };
}
/** Why Add to cart is closed: choices are missing, the choice cannot be bought, or this is a draft or sample in a preview. */
export type VariantBlock = "choose_options" | "out_of_stock" | "preview_only";

/** What the product page shows for the shopper's choices so far. Everything a theme needs, and nothing for it to decide. */
export interface VariantSelectionVM {
  options: SelectableOption[];
  /** Null until the choices name a variant. */
  variant: ProductVariantVM | null;
  price: Money;
  /** True while no variant is chosen and the variants differ in price. */
  priceFrom: boolean;
  compareAt: Money | null;
  discountPercent: number;
  stock: { status: StockStatus; label: string };
  /** The chosen variant's picture, if it has one. */
  imageId: string | null;
  block: VariantBlock | null;
}

export { initialSelection };

export function toVariantSelectionVM(product: ProductDetailVM, selected: SelectedOptions): VariantSelectionVM {
  const variant = resolveVariant(product, selected);
  const chosenAll = product.options.every((_, index) => Boolean(selected[index]));
  const stock = variant
    ? { status: variant.availability, label: variant.onlyLeft !== null && variant.availability !== "out_of_stock" ? "Only " + variant.onlyLeft + " left" : STOCK_LABELS[variant.availability] }
    : product.stock;

  let block: VariantBlock | null = null;
  if (product.previewLabel !== null) block = "preview_only";
  else if (!variant) block = chosenAll ? "out_of_stock" : "choose_options";
  else if (variant.availability === "out_of_stock") block = "out_of_stock";

  return {
    options: selectableOptions(product, selected),
    variant,
    price: variant?.price ?? product.priceRange.min,
    priceFrom: !variant && product.priceRange.min.amount < product.priceRange.max.amount,
    compareAt: variant?.compareAt ?? null,
    discountPercent: variant?.discountPercent ?? 0,
    stock,
    imageId: variant?.imageId ?? null,
    block,
  };
}
/* @theme-integration-patch:detail */
