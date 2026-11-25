/**
 * Sprint 8 (S8-B3, then B4): which dashboard menu items and settings tabs a role sees. Since S8-B4 everything here is derived from lib/role-access.ts, which is
 * built on the capability matrix of packages/auth, so there is no second table to keep in step. The menu only FOLLOWS the server: it hides what a role cannot use.
 */
import { dashboardRole, MENU_CAPABILITY, roleSeesMenu, SELLER_ROLES, settingsTabsFor, type SellerRole } from "./role-access";

export type StoreRole = SellerRole;

export const menuRole = dashboardRole;

/** Menu href -> the roles that see it (derived). */
export const MENU_ROLES: Readonly<Record<string, readonly StoreRole[]>> = Object.freeze(
  Object.fromEntries(Object.keys(MENU_CAPABILITY).map((href) => [href, SELLER_ROLES.filter((role) => roleSeesMenu(role, href))])),
);

export { roleSeesMenu, settingsTabsFor };
