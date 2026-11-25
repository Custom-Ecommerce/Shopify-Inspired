/**
 * Sprint 8 (S8-B3, D-118): which dashboard menu items a role sees. The menu only FOLLOWS the server: it hides what a role cannot use, the backend is what refuses it (a hidden page that
 * is opened by address still gets 403 from every API call). A store without a role (an older backend) is the owner's. A role this table does not know sees nothing but the account
 * pages (fail closed). test/role-menu.test.ts compares this table with the capability matrix of packages/auth, so the two cannot drift.
 */

export type StoreRole = "owner" | "manager" | "staff" | "support";

const ALL: readonly StoreRole[] = ["owner", "manager", "staff", "support"];
const OWNER: readonly StoreRole[] = ["owner"];
const OWNER_MANAGER: readonly StoreRole[] = ["owner", "manager"];

/** Menu href (store relative) -> the roles that may use it. Every NAV_GROUPS link has a row. */
export const MENU_ROLES: Readonly<Record<string, readonly StoreRole[]>> = Object.freeze({
  "/": ALL,
  "/products": ["owner", "manager", "staff"],
  "/categories": ["owner", "manager", "staff"],
  "/media": ["owner", "manager", "staff"],
  "/orders": ALL,
  "/inbox": ["owner", "manager", "support"],
  "/customers": ["owner", "manager", "support"],
  "/blocklist": OWNER_MANAGER,
  "/inventory": ["owner", "manager", "staff"],
  "/returns": ["owner", "manager", "support"],
  "/reviews": ["owner", "manager", "support"],
  "/abandoned-carts": OWNER_MANAGER,
  "/discounts": OWNER_MANAGER,
  "/referrals": OWNER_MANAGER,
  "/broadcast": OWNER_MANAGER,
  "/blog": OWNER_MANAGER,
  "/pages": OWNER_MANAGER,
  "/analytics": OWNER_MANAGER,
  "/earnings": OWNER,
  "/billing": OWNER,
  "/store": OWNER_MANAGER,
  "/domain": OWNER,
  "/account": ALL,
  "/support": ALL,
});

/** The role of the signed-in user in a store as the menu reads it: a missing role is the owner's (an older backend), an unknown one is nobody's. */
export function menuRole(role: unknown): StoreRole | null {
  if (role === undefined || role === null) return "owner";
  return typeof role === "string" && (ALL as readonly string[]).includes(role) ? (role as StoreRole) : null;
}

/** Whether the role sees a menu item. Fail closed: an unknown role, or an href the table does not know, sees nothing there. */
export function roleSeesMenu(role: unknown, href: string): boolean {
  const effective = menuRole(role);
  const allowed = MENU_ROLES[href];
  return effective !== null && allowed !== undefined && allowed.includes(effective);
}

/** The settings tabs a role may open (the owner all of them; a manager all but payments and fraud, which stay with the owner). Others have no settings page at all. */
export function settingsTabsFor(role: unknown, tabs: readonly string[]): string[] {
  const effective = menuRole(role);
  if (effective === "owner") return [...tabs];
  if (effective === "manager") return tabs.filter((tab) => tab !== "payments" && tab !== "fraud");
  return [];
}
