export type FeatureIconName = "Truck" | "Globe" | "Flower2" | "ScrollText";

export interface FeatureItem {
  id: string;
  icon: FeatureIconName;
  title: string;
  description: string;
}

export interface FeaturesProps {
  data: FeatureItem[];
}
