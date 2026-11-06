import type { NormalizedCategory } from "../../../model";

export interface CollectionHeaderProps {
  title: string;
  description?: string;
  itemCount: number;
  category?: NormalizedCategory | null;
}