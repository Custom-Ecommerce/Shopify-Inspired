import { CreditCard, LayoutDashboard, Package, Percent, RefreshCw, ScrollText, Settings, Store, Users, type LucideIcon } from "lucide-react";
import type { NavIconKey } from "./nav-config";

export const NAV_ICONS: Record<NavIconKey, LucideIcon> = {
  overview: LayoutDashboard,
  stores: Store,
  products: Package,
  sellers: Users,
  subscriptions: CreditCard,
  commission: Percent,
  sync: RefreshCw,
  audit: ScrollText,
  settings: Settings,
};
