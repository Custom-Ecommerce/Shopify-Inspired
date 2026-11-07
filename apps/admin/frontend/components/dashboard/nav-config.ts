export type NavIconKey = "overview" | "stores" | "products" | "sellers" | "subscriptions" | "commission" | "sync" | "audit" | "settings";

export interface NavItem {
  label: string;
  href: string;
  icon: NavIconKey;
  /** live: the page exists and the item is a link. soon: the page is built in the named phase. */
  status: "live" | "soon";
  phase?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operations",
    items: [
      { label: "Overview", href: "/", icon: "overview", status: "live" },
      { label: "Stores", href: "/stores", icon: "stores", status: "live" },
      { label: "Products", href: "/products", icon: "products", status: "live" },
      { label: "Sellers", href: "/sellers", icon: "sellers", status: "live" },
    ],
  },
  {
    label: "Commerce",
    items: [
      { label: "Subscriptions", href: "/subscriptions", icon: "subscriptions", status: "live" },
      { label: "Commission", href: "/commission", icon: "commission", status: "live" },
    ],
  },
  {
    label: "Platform",
    items: [
      { label: "Sync", href: "/sync", icon: "sync", status: "live" },
      { label: "Audit log", href: "/audit", icon: "audit", status: "live" },
      { label: "Settings", href: "/settings", icon: "settings", status: "live" },
    ],
  },
];

/** The page title for the header, from the navigation entry that owns the path. */
export function pageTitleFor(pathname: string): string {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      const match = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(item.href + "/");
      if (match) return item.label;
    }
  }
  return "Console";
}
