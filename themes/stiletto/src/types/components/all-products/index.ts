import type { NormalizedCategory, NormalizedProduct } from "../../../model";

export interface CategoryProductSectionProps {
  category: NormalizedCategory;
  products: NormalizedProduct[];
}

export interface AllProductsListProps {
  categories: NormalizedCategory[];
  products: NormalizedProduct[];
}