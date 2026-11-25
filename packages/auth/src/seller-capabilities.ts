/**
 * Sprint 8 (S8-B2, D-118): the seller side's staff roles and the ONE capability matrix, the twin of admin-levels.ts. Every seller route will declare a capability
 * (S8-B3 sweeps them); the role of the signed-in user in THAT store decides. Where this matrix is silent the answer is deny. The server enforces; the dashboard only
 * follows (it hides what a role cannot use).
 *
 *   owner     the seller account that owns the store: everything
 *   manager   everything for the store EXCEPT the owner-only list below
 *   staff     orders, products (with their categories and media) and inventory
 *   support   orders (view, update customer notes), returns, customers, reviews reply, contact inbox and tickets
 *
 * OWNER-ONLY: the store settings groups payments and fraud, go-live, domain, billing and plan, API keys, team, earnings, payouts, commission data and referrals.
 *
 * Fail closed: an unknown role is denied; a MISSING role (undefined, null) is NOT an owner (unlike an admin account from before levels): it is denied everything. An
 * unknown capability is denied for everyone, the owner included.
 */

export const SELLER_ROLES = ['owner', 'manager', 'staff', 'support'] as const;
export type SellerRole = (typeof SELLER_ROLES)[number];

/** The roles a team member can hold (the owner is the account that owns the store, never a member row). */
export const STAFF_ROLES = ['manager', 'staff', 'support'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const SELLER_CAPABILITIES = [
  // Everyone who works in the store (S8-B3): the bell (only the alerts of their role) and the safe subset of the store's settings
  'alerts.read',
  'store.view',
  // Orders
  'orders.read',
  'orders.write',
  'orders.notes',
  // Catalog
  'products.read',
  'products.write',
  'categories.read',
  'categories.write',
  'media.read',
  'media.write',
  'inventory.read',
  'inventory.write',
  // After sale
  'returns.read',
  'returns.write',
  // S8-B3: recording a refund is not the same as marking a return received (support marks, never refunds)
  'returns.refund',
  'customers.read',
  'customers.write',
  'customers.export',
  'reviews.read',
  'reviews.reply',
  'contact.read',
  'contact.write',
  'tickets.read',
  'tickets.write',
  // Growth and content
  'discounts.read',
  'discounts.write',
  'analytics.read',
  'content.read',
  'content.write',
  'broadcast.manage',
  'abandoned_carts.manage',
  'blocklist.manage',
  // Store settings
  'settings.read',
  'settings.write',
  'settings.tax',
  // OWNER-ONLY
  'settings.payments',
  'settings.fraud',
  'settings.domain',
  'settings.payout',
  'go_live',
  'billing.manage',
  'api_keys.manage',
  'team.manage',
  'earnings.read',
  'payouts.manage',
  'commission.read',
  // S8-B5: the referral code and the list of referred sellers
  'referrals.read',
] as const;
export type SellerCapability = (typeof SELLER_CAPABILITIES)[number];

/** What only the owner may do. The manager role is every capability except these. */
export const OWNER_ONLY_CAPABILITIES: readonly SellerCapability[] = [
  'settings.payments',
  'settings.fraud',
  'settings.domain',
  'settings.payout',
  'go_live',
  'billing.manage',
  'api_keys.manage',
  'team.manage',
  'earnings.read',
  'payouts.manage',
  'commission.read',
  'referrals.read',
];

const ownerOnly: ReadonlySet<string> = new Set(OWNER_ONLY_CAPABILITIES);

const MANAGER: readonly SellerCapability[] = SELLER_CAPABILITIES.filter((capability) => !ownerOnly.has(capability));

const STAFF: readonly SellerCapability[] = [
  'alerts.read',
  'store.view',
  'orders.read',
  'orders.write',
  'orders.notes',
  'products.read',
  'products.write',
  'categories.read',
  'categories.write',
  'media.read',
  'media.write',
  'inventory.read',
  'inventory.write',
];

const SUPPORT: readonly SellerCapability[] = [
  'alerts.read',
  'store.view',
  'orders.read',
  'orders.notes',
  'returns.read',
  'returns.write',
  'customers.read',
  'customers.write',
  'reviews.read',
  'reviews.reply',
  'contact.read',
  'contact.write',
  'tickets.read',
  'tickets.write',
];

/** The whole matrix, in one place. owner has every capability. */
export const SELLER_CAPABILITY_MATRIX: Readonly<Record<SellerRole, readonly SellerCapability[]>> = Object.freeze({
  owner: SELLER_CAPABILITIES,
  manager: MANAGER,
  staff: STAFF,
  support: SUPPORT,
});

export const SELLER_ROLE_LABELS: Readonly<Record<SellerRole, string>> = Object.freeze({
  owner: 'Owner',
  manager: 'Manager',
  staff: 'Staff',
  support: 'Support',
});

export function isSellerRole(value: unknown): value is SellerRole {
  return typeof value === 'string' && (SELLER_ROLES as readonly string[]).includes(value);
}

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && (STAFF_ROLES as readonly string[]).includes(value);
}

export function isSellerCapability(value: unknown): value is SellerCapability {
  return typeof value === 'string' && (SELLER_CAPABILITIES as readonly string[]).includes(value);
}

/**
 * Whether a role may use a capability. Fail closed: a missing or unknown role is denied (it is never read as owner), and so is an unknown capability, for every role.
 */
export function sellerCan(role: unknown, capability: unknown): boolean {
  if (!isSellerRole(role) || !isSellerCapability(capability)) return false;
  return (SELLER_CAPABILITY_MATRIX[role] as readonly string[]).includes(capability);
}

/** The capabilities of a role, for the dashboard to follow. An unknown or missing role has none. */
export function sellerCapabilities(role: unknown): SellerCapability[] {
  return isSellerRole(role) ? [...SELLER_CAPABILITY_MATRIX[role]] : [];
}

export class SellerCapabilityError extends Error {
  readonly capability: string;
  constructor(capability: string) {
    super('Forbidden: missing capability ' + capability);
    this.name = 'SellerCapabilityError';
    this.capability = capability;
  }
}

/** Throws SellerCapabilityError (the seller backend turns it into a 403 CAPABILITY_DENIED) when the role lacks the capability. */
export function assertSellerCan(role: unknown, capability: string): void {
  if (!sellerCan(role, capability)) throw new SellerCapabilityError(capability);
}

/** The settings group of PATCH /api/stores/:id and the capability it needs (S8-B2). A group this map does not know needs the general settings capability. */
export const SETTINGS_GROUP_CAPABILITY: Readonly<Record<string, SellerCapability>> = Object.freeze({
  payments: 'settings.payments',
  fraud: 'settings.fraud',
  domain: 'settings.domain',
  payout: 'settings.payout',
  tax: 'settings.tax',
});

/** The capabilities a settings update needs: one per group sent (settings.write for every group the map does not name). */
export function settingsGroupCapabilities(groups: readonly string[]): SellerCapability[] {
  const needed = new Set<SellerCapability>();
  for (const group of groups) needed.add(SETTINGS_GROUP_CAPABILITY[group] ?? 'settings.write');
  return [...needed];
}
