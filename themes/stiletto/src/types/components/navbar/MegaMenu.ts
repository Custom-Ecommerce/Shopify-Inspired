import type { LinkItem } from "../../shared/LinkItem";

export interface MegaMenuColumnItem {
  label: string;
  href: string;
  type: "main" | "sub";
}

export interface MegaMenuData {
  column1: MegaMenuColumnItem[];
  column2: LinkItem[];
  promo: {
    image: string;
    title: string;
    buttonText: string;
    href: string;
  };
}
