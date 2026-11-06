import { discountPercent } from "@markaz/platform-kit/commerce";
import { toMoney } from "../domain/money";
import type { Money } from "../domain/money";
import type { StockStatus, StorefrontProductDetail, StorefrontProductOption, StorefrontProductVariant } from "../transport/types";
import { toProductCardVM } from "./product-card";
import type { ProductCardVM } from "./product-card";

export interface ProductVariantVM {
  id: string;
  title: string;
  price: Money;
  compareAt: Money | null;
  discountPercent: number;
  availability: StockStatus;
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
    optionValues: [...variant.optionValues],
    imageId: variant.imageId,
  };
}

export interface ProductDetailVM extends ProductCardVM {
  options: StorefrontProductOption[];
  variants: ProductVariantVM[];
  description: string | null;
  highlights: string[];
  gallery: { url: string; alt: string }[];
  deliveryFee: Money;
  deliveryLabel: string;
  canAddToCart: boolean;
  /** Rich description when the backend sends one. */
  descriptionHtml?: string | null;
  tags?: string[];
}

export function toProductDetailVM(dto: StorefrontProductDetail): ProductDetailVM {
  const deliveryFee = toMoney(dto.deliveryCharge);
  const card = toProductCardVM(dto);
  return {
    ...card,
    options: dto.options.map((option) => ({ name: option.name, values: [...option.values] })),
    variants: dto.variants.map(toVariantVM),
    description: dto.description,
    highlights: [...dto.highlights],
    gallery: dto.images.map((image) => ({ url: image.url, alt: image.alt })),
    deliveryFee,
    deliveryLabel: dto.deliveryCharge === 0 ? "Free delivery" : "Delivery " + deliveryFee.formatted,
    canAddToCart: card.canQuickAdd,
    descriptionHtml: dto.descriptionHtml ?? null,
    tags: [...dto.tags],
  };
}
/* @theme-integration-patch:detail */
