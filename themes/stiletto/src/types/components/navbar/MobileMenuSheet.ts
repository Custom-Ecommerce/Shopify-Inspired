import type { NavItem } from "./NavItem";

export interface MobileMenuSheetProps {
  brand: { name: string; href: string; logo?: string };
  menuLogo?: string;
  navLinks: NavItem[];
}
