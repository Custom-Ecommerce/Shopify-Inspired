import { discountPercent } from "@markaz/platform-kit/commerce";
import { toMoney } from "../domain/money";
import type { Money } from "../domain/money";
import type { StockStatus, StorefrontProductSummary } from "../transport/types";

export interface ProductCardVM {
  id: string;
  slug: string;
  title: string;
  image: { url: string; alt: string } | null;
  /** The from price: the cheapest variant's. */
  price: Money;
  compareAt: Money | null;
  discountPercent: number;
  stock: { status: StockStatus; label: string };
  /** Derived from the variants: out of stock only when every variant is. */
  availability: StockStatus;
  hasVariants: boolean;
  defaultVariantId: string;
  /** True when one click can buy this product: it is available, and there is no variant to choose. */
  canQuickAdd: boolean;
  rating: { average: number; count: number } | null;
  /** The product's categories. Optional so existing consumers are unaffected. */
  categories?: { id: string; slug: string; name: string }[];
}

const STOCK_LABELS: Record<StockStatus, string> = {
  in_stock: "In stock",
  low_stock: "Only a few left",
  out_of_stock: "Out of stock",
};

export function toProductCardVM(dto: StorefrontProductSummary): ProductCardVM {
  const compareAtAmount =
    dto.compareAtPrice !== null && dto.compareAtPrice > dto.price ? dto.compareAtPrice : null;

  return {
    id: dto.id,
    slug: dto.slug,
    title: dto.title,
    image: dto.primaryImage ? { url: dto.primaryImage.url, alt: dto.primaryImage.alt } : null,
    price: toMoney(dto.price),
    compareAt: compareAtAmount === null ? null : toMoney(compareAtAmount),
    discountPercent: discountPercent(dto.price, compareAtAmount),
    stock: { status: dto.stockStatus, label: STOCK_LABELS[dto.stockStatus] },
    availability: dto.stockStatus,
    hasVariants: dto.hasVariants,
    defaultVariantId: dto.defaultVariantId,
    canQuickAdd: !dto.hasVariants && dto.stockStatus !== "out_of_stock",
    rating: dto.reviewCount > 0 ? { average: dto.avgRating, count: dto.reviewCount } : null,
    categories: dto.categories.map((c) => ({ id: c.id, slug: c.slug, name: c.name })),
  };
}
/* @theme-integration-patch:card */
