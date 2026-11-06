import type { NormalizedProduct } from "../../../model";

export interface ProductShowcaseBanner {
  label: string;
  title: string;
  subtitle: string;
  image: string;
  primaryBtnText: string;
  primaryBtnLink: string;
  secondaryBtnText: string;
  secondaryBtnLink: string;
}

export interface ProductShowcaseProps {
  banner: ProductShowcaseBanner;
  products: NormalizedProduct[];
}
