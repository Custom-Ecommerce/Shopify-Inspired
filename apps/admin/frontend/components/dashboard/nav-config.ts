export type NavIconKey = "overview" | "stores" | "products" | "sellers" | "subscriptions" | "commission" | "sync" | "audit" | "settings";

export interface NavItem {
  label: string;
  href: string;
  icon: NavIconKey;
  /** live: the page exists and the item is a link. soon: the page is built in the named phase. */
  status: "live" | "soon";
  phase?: string;
  /** Sprint 6 (S6-B6): the capability the page needs. The server enforces it; the console only hides what the level cannot use. */
  capability?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operations",
    items: [
      { label: "Overview", href: "/", icon: "overview", status: "live", capability: "overview.read" },
      { label: "Stores", href: "/stores", icon: "stores", status: "live", capability: "stores.read" },
      { label: "Products", href: "/products", icon: "products", status: "live", capability: "products.moderate" },
      { label: "Reviews", href: "/reviews", icon: "products", status: "live", capability: "reviews.moderate" },
      { label: "Orders", href: "/orders", icon: "stores", status: "live", capability: "orders.read" },
      { label: "Sellers", href: "/sellers", icon: "sellers", status: "live", capability: "sellers.read" },
      { label: "Support", href: "/support", icon: "sellers", status: "live", capability: "tickets.read" },
      { label: "Contact", href: "/contact", icon: "stores", status: "live", capability: "contact.read" },
    ],
  },
  {
    label: "Commerce",
    items: [
      { label: "Subscriptions", href: "/subscriptions", icon: "subscriptions", status: "live", capability: "plans.read" },
      { label: "Subscription payments", href: "/subscription-payments", icon: "subscriptions", status: "live", capability: "payments.read" },
      { label: "Commission", href: "/commission", icon: "commission", status: "live", capability: "commission.read" },
      { label: "Referrals", href: "/referrals", icon: "sellers", status: "live", capability: "referrals.read" },
    ],
  },
  {
    label: "Platform",
    items: [
      { label: "Sync", href: "/sync", icon: "sync", status: "live", capability: "sync.read" },
      { label: "Audit log", href: "/audit", icon: "audit", status: "live", capability: "audit.read" },
      { label: "Settings", href: "/settings", icon: "settings", status: "live", capability: "settings.read" },
      { label: "Admin users", href: "/users", icon: "sellers", status: "live", capability: "users.manage" },
      { label: "Retention", href: "/retention", icon: "settings", status: "live", capability: "settings.write" },
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

/** The groups a level can use: an item whose capability is missing is hidden, and a group with no item left disappears. null keeps everything (the session has not said yet). */
export function visibleNavGroups(capabilities: readonly string[] | null): NavGroup[] {
  if (capabilities === null) return NAV_GROUPS;
  return NAV_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => item.capability === undefined || capabilities.includes(item.capability)) })).filter((group) => group.items.length > 0);
}

/** Where a level lands: the overview when it may read it, else the first page it can use. */
export function homeFor(capabilities: readonly string[] | null): string {
  const first = visibleNavGroups(capabilities).flatMap((group) => group.items).find((item) => item.status === "live");
  return first?.href ?? "/login";
}
