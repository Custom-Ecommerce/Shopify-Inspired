import { adminCan, type AdminCapability, type AdminLevel } from '@markaz/auth/admin-levels';

/*
 * Which screens each admin level gets (EP-33.US01.T01). The tabs are the level's daily work; anything else its capabilities allow is under More. The matrix
 * of packages/auth is not widened here: the server refuses anything else anyway.
 */

export type AdminTab = 'overview' | 'orders' | 'payments' | 'tickets' | 'sellers' | 'sync';

const NEEDS: Record<AdminTab, AdminCapability> = {
  overview: 'overview.read',
  orders: 'orders.read',
  payments: 'payments.read',
  tickets: 'tickets.read',
  sellers: 'sellers.read',
  sync: 'sync.read',
};

const TABS: Record<AdminLevel, readonly AdminTab[]> = {
  owner: ['overview', 'orders', 'payments', 'tickets'],
  finance: ['overview', 'payments'],
  operations: ['overview', 'sellers', 'sync'],
  customer_support: ['orders', 'tickets'],
};

export const can = (level: AdminLevel | null, capability: AdminCapability): boolean => level !== null && adminCan(level, capability);

export const allows = (level: AdminLevel | null, screen: AdminTab): boolean => can(level, NEEDS[screen]);

export function tabsFor(level: AdminLevel | null): AdminTab[] {
  return level === null ? [] : TABS[level].filter((tab) => allows(level, tab));
}

/** The screens under More. */
export function moreFor(level: AdminLevel | null): AdminTab[] {
  const tabs = tabsFor(level);
  return (Object.keys(NEEDS) as AdminTab[]).filter((screen) => !tabs.includes(screen) && allows(level, screen) && (screen === 'sellers' || screen === 'sync'));
}
