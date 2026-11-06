import { CreditCard, LayoutDashboard, Percent, RefreshCw, ScrollText, Settings, Store, Tags, Users, type LucideIcon } from "lucide-react";
import type { NavIconKey } from "./nav-config";

export const NAV_ICONS: Record<NavIconKey, LucideIcon> = {
  overview: LayoutDashboard,
  stores: Store,
  sellers: Users,
  subscriptions: CreditCard,
  commission: Percent,
  sync: RefreshCw,
  audit: ScrollText,
  categories: Tags,
  settings: Settings,
};
