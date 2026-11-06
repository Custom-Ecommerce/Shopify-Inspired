import type { NormalizedCategory, NormalizedProduct } from "../../../model";

export interface AllCollectionsGridProps {
  categories: NormalizedCategory[];
}

export interface SingleCollectionProductGridProps {
  products: NormalizedProduct[];
}