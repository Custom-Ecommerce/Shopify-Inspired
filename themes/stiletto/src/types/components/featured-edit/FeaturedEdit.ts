import type { NormalizedProduct } from "../../../model";

export interface FeaturedEditTab {
  label: string;
  products: NormalizedProduct[];
}

export interface FeaturedEditProps {
  title: string;
  buttonText: string;
  buttonLink: string;
  tabs: FeaturedEditTab[];
}
