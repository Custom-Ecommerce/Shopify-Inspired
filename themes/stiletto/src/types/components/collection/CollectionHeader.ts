import type { NormalizedCategory } from "../../../model";

export interface CollectionHeaderProps {
  title: string;
  description?: string;
  /** Left out on pages that are not a list of products (a static page, 404, unavailable): no count line is shown. */
  itemCount?: number;
  category?: NormalizedCategory | null;
}