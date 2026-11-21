/**
 * Sprint 6 EP-20 (S6-B6, D-118): admin levels and the ONE capability matrix. Every admin route declares a capability; the level of the signed-in admin
 * decides. Where this matrix is silent the answer is deny. The server enforces; the console only follows (it hides what the level cannot use).
 *
 *   owner             everything, including admin users and the audit export
 *   finance           payments (read, confirm, reject), payouts, commission and reports, plans read
 *   operations        sellers and stores (read, status, store limit), sync, plans read, settings read
 *   customer_support  orders view (read only), sellers read, tickets and the contact inbox (Sprint 7)
 *
 * An admin with no level (an account from before S6-B6) is an OWNER, so nothing locks out on upgrade; the migration script writes it explicitly.
 */

export const ADMIN_LEVELS = ['owner', 'finance', 'operations', 'customer_support'] as const;
export type AdminLevel = (typeof ADMIN_LEVELS)[number];

export const ADMIN_CAPABILITIES = [
  'overview.read',
  'orders.read',
  'sellers.read',
  'sellers.status',
  'sellers.store_limit',
  'stores.read',
  'stores.status',
  'products.moderate',
  'reviews.moderate',
  'plans.read',
  'plans.write',
  'settings.read',
  'settings.write',
  'payments.read',
  'payments.decide',
  'payments.void',
  'payouts.manage',
  'commission.read',
  'commission.write',
  'sync.read',
  'sync.manage',
  'audit.read',
  'audit.export',
  'users.manage',
  'tickets.read',
  'tickets.reply',
  'contact.read',
] as const;
export type AdminCapability = (typeof ADMIN_CAPABILITIES)[number];

const FINANCE: readonly AdminCapability[] = ['overview.read', 'payments.read', 'payments.decide', 'payouts.manage', 'commission.read', 'commission.write', 'plans.read'];
const OPERATIONS: readonly AdminCapability[] = [
  'overview.read',
  'sellers.read',
  'sellers.status',
  'sellers.store_limit',
  'stores.read',
  'stores.status',
  'sync.read',
  'sync.manage',
  'plans.read',
  'settings.read',
];
const CUSTOMER_SUPPORT: readonly AdminCapability[] = ['orders.read', 'sellers.read', 'tickets.read', 'tickets.reply', 'contact.read'];

/** The whole matrix, in one place. owner has every capability. */
export const ADMIN_CAPABILITY_MATRIX: Readonly<Record<AdminLevel, readonly AdminCapability[]>> = Object.freeze({
  owner: ADMIN_CAPABILITIES,
  finance: FINANCE,
  operations: OPERATIONS,
  customer_support: CUSTOMER_SUPPORT,
});

export function isAdminLevel(value: unknown): value is AdminLevel {
  return typeof value === 'string' && (ADMIN_LEVELS as readonly string[]).includes(value);
}

/** The level of an admin account: a missing or unknown level reads as owner (back-compat for accounts from before levels). */
export function effectiveAdminLevel(value: unknown): AdminLevel {
  return isAdminLevel(value) ? value : 'owner';
}

export const LEVEL_LABELS: Readonly<Record<AdminLevel, string>> = Object.freeze({
  owner: 'Owner',
  finance: 'Finance',
  operations: 'Operations',
  customer_support: 'Customer support',
});

/** Whether a level may use a capability. An unknown capability is denied for everyone. */
export function adminCan(level: AdminLevel | null | undefined, capability: string): boolean {
  const effective = effectiveAdminLevel(level);
  return (ADMIN_CAPABILITY_MATRIX[effective] as readonly string[]).includes(capability);
}

/** The capabilities of a level, for the console to follow. */
export function adminCapabilities(level: AdminLevel | null | undefined): AdminCapability[] {
  return [...ADMIN_CAPABILITY_MATRIX[effectiveAdminLevel(level)]];
}

export class AdminCapabilityError extends Error {
  readonly capability: string;
  constructor(capability: string) {
    super('Forbidden: missing capability ' + capability);
    this.name = 'AdminCapabilityError';
    this.capability = capability;
  }
}

/** Throws AdminCapabilityError (the admin backend turns it into a 403) when the level lacks the capability. */
export function assertAdminCan(level: AdminLevel | null | undefined, capability: string): void {
  if (!adminCan(level, capability)) throw new AdminCapabilityError(capability);
}
