import { toMoney } from "../domain/money";
import type { Money } from "../domain/money";
import type { StockStatus, StorefrontProductSummary } from "../transport/types";

export interface ProductCardVM {
  id: string;
  slug: string;
  title: string;
  image: { url: string; alt: string } | null;
  price: Money;
  compareAt: Money | null;
  discountPercent: number;
  stock: { status: StockStatus; label: string };
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
    dto.originalPrice !== null && dto.originalPrice > dto.price ? dto.originalPrice : null;

  return {
    id: dto.id,
    slug: dto.slug,
    title: dto.title,
    image: dto.primaryImage ? { url: dto.primaryImage.url, alt: dto.primaryImage.alt } : null,
    price: toMoney(dto.price),
    compareAt: compareAtAmount === null ? null : toMoney(compareAtAmount),
    discountPercent:
      compareAtAmount === null ? 0 : Math.round((1 - dto.price / compareAtAmount) * 100),
    stock: { status: dto.stockStatus, label: STOCK_LABELS[dto.stockStatus] },
    rating: dto.reviewCount > 0 ? { average: dto.avgRating, count: dto.reviewCount } : null,
    categories: dto.categories.map((c) => ({ id: c.id, slug: c.slug, name: c.name })),
  };
}
/* @theme-integration-patch:card */
