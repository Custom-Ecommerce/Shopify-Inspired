import type { NavItem } from "./NavItem";
import type { AnnouncementData } from "./AnnouncementBar";
import type { SearchDrawerData } from "./SearchDrawer";
import type { CartDrawerData } from "./CartDrawer";
import type { NormalizedCategory } from "../../../model";

export interface HeaderProps {
  announcement?: AnnouncementData;
  brand: { name: string; href: string; logo?: string };
  menuLogo?: string;
  navLinks: NavItem[];
  categories?: NormalizedCategory[];
  searchDrawerData?: SearchDrawerData;
  cartDrawerData?: CartDrawerData;
}
