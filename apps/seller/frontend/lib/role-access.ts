/**
 * Sprint 8 (S8-B4, D-118): what the dashboard shows to a role, built on the ONE seller capability matrix of packages/auth (seller-capabilities.ts). The server
 * enforces every call; this only hides what a role cannot use (a hidden page opened by address still answers 403 from every API call).
 *
 * seller-capabilities.ts is pure TypeScript with no imports, so the browser bundle can take it from the package source (next.config.mjs: experimental.externalDir);
 * the portal does not depend on @markaz/auth, whose other files are server code.
 *
 * A store with no role (an older backend) is the owner's. A role this code does not know sees nothing role-gated (fail closed).
 */
import {
  SELLER_ROLE_LABELS,
  SELLER_ROLES,
  sellerCan,
  sellerCapabilities,
  type SellerCapability,
  type SellerRole,
} from "../../../../packages/auth/src/seller-capabilities";

export { sellerCapabilities, SELLER_ROLES };
export type { SellerCapability, SellerRole };

/** The role as the dashboard reads it, or null for one it does not know. */
export function dashboardRole(role: unknown): SellerRole | null {
  if (role === undefined || role === null) return "owner";
  return typeof role === "string" && (SELLER_ROLES as readonly string[]).includes(role) ? (role as SellerRole) : null;
}

/** Whether the role may use a capability (fail closed for an unknown role). */
export function roleCan(role: unknown, capability: SellerCapability): boolean {
  const effective = dashboardRole(role);
  return effective !== null && sellerCan(effective, capability);
}

/** Menu href (store relative) -> the capability its page needs; null: the account pages, for every role. Every sidebar link has a row. */
export const MENU_CAPABILITY: Readonly<Record<string, SellerCapability | null>> = Object.freeze({
  "/": "alerts.read",
  "/products": "products.read",
  "/categories": "categories.read",
  "/media": "media.read",
  "/orders": "orders.read",
  "/inbox": "contact.read",
  "/customers": "customers.read",
  "/blocklist": "blocklist.manage",
  "/inventory": "inventory.read",
  "/returns": "returns.read",
  "/reviews": "reviews.read",
  "/abandoned-carts": "abandoned_carts.manage",
  "/discounts": "discounts.read",
  "/referrals": "referrals.read",
  "/broadcast": "broadcast.manage",
  "/blog": "content.read",
  "/pages": "content.read",
  "/analytics": "analytics.read",
  "/earnings": "earnings.read",
  "/billing": "billing.manage",
  "/store": "settings.read",
  "/domain": "settings.domain",
  "/team": "team.manage",
  "/api-keys": "api_keys.manage",
  "/account": null,
  "/support": null,
});

/** Store settings tab -> the capability that saves it. A tab with no row needs the general settings capability. */
export const SETTINGS_TAB_CAPABILITY: Readonly<Record<string, SellerCapability>> = Object.freeze({
  payments: "settings.payments",
  fraud: "settings.fraud",
  tax: "settings.tax",
});

export const settingsTabCapability = (tab: string): SellerCapability => SETTINGS_TAB_CAPABILITY[tab] ?? "settings.write";

/** The owner-only actions and buttons of the dashboard, by name, with the capability behind each (S8-B4 task 2). */
export const OWNER_ACTION_CAPABILITY = Object.freeze({
  billing: "billing.manage",
  domain: "settings.domain",
  payments: "settings.payments",
  fraud: "settings.fraud",
  goLive: "go_live",
  team: "team.manage",
  apiKeys: "api_keys.manage",
  earnings: "earnings.read",
  payouts: "payouts.manage",
} satisfies Record<string, SellerCapability>);

export type OwnerAction = keyof typeof OWNER_ACTION_CAPABILITY;

export const canUse = (role: unknown, action: OwnerAction): boolean => roleCan(role, OWNER_ACTION_CAPABILITY[action]);

/** Whether the role may see a menu link. Fail closed: an unknown role, or a link with no row, is hidden. */
export function roleSeesMenu(role: unknown, href: string): boolean {
  if (dashboardRole(role) === null || !(href in MENU_CAPABILITY)) return false;
  const capability = MENU_CAPABILITY[href];
  return capability === null || capability === undefined ? true : roleCan(role, capability);
}

/** The word shown next to a store the user works in as a team member (V-05); null for their own store, or a role this code does not know. */
export function memberRoleLabel(role: unknown): string | null {
  const effective = dashboardRole(role);
  return effective === null || effective === "owner" ? null : SELLER_ROLE_LABELS[effective];
}

export const ROLE_CLOSED_TEXT = "Your role in this store cannot open this page. Ask the store owner if you need it.";

/**
 * Whether a page opened by its address belongs to the role: the page below /s/<storeId> is judged by the menu row of its first segment, so a page the
 * menu hides is not drawn either (a half page, an empty tab bar or the member's own billing under another seller's store would only mislead). A path with
 * no menu row is left to the page: the server enforces every call in any case.
 */
export function roleMayOpen(role: unknown, pathname: string): boolean {
  const segment = pathname.replace(/^\/s\/[^/]+/, "").split("/")[1] ?? "";
  const href = "/" + segment;
  return href in MENU_CAPABILITY ? roleSeesMenu(role, href) : true;
}

/** Whether a step of the go-live checklist has a button this role can use: its settings tab, the domain page, or (products, account, stock) a page the role has. */
export function canFixReadiness(role: unknown, tab: string): boolean {
  if (tab === "account") return true;
  if (tab === "products") return roleCan(role, "products.write");
  if (tab === "inventory") return roleCan(role, "inventory.write");
  if (tab === "domain") return canUse(role, "domain");
  if (tab === "payout") return canUse(role, "payouts");
  return roleCan(role, settingsTabCapability(tab));
}

/** The settings tabs a role may open: the ones whose capability it has. */
export function settingsTabsFor(role: unknown, tabs: readonly string[]): string[] {
  return tabs.filter((tab) => roleCan(role, settingsTabCapability(tab)));
}
