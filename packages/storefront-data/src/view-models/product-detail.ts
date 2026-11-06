import { toMoney } from "../domain/money";
import type { Money } from "../domain/money";
import type { StorefrontProductDetail } from "../transport/types";
import { toProductCardVM } from "./product-card";
import type { ProductCardVM } from "./product-card";

export interface ProductDetailVM extends ProductCardVM {
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
  return {
    ...toProductCardVM(dto),
    description: dto.description,
    highlights: [...dto.highlights],
    gallery: dto.images.map((image) => ({ url: image.url, alt: image.alt })),
    deliveryFee,
    deliveryLabel: dto.deliveryCharge === 0 ? "Free delivery" : "Delivery " + deliveryFee.formatted,
    canAddToCart: dto.stockStatus !== "out_of_stock",
    descriptionHtml: dto.descriptionHtml ?? null,
    tags: [...dto.tags],
  };
}
/* @theme-integration-patch:detail */
