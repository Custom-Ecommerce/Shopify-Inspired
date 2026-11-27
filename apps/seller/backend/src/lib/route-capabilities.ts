import type { SellerCapability, SellerRole } from '@markaz/auth';
import { sellerCan, SELLER_ROLES } from '@/lib/services';

/**
 * Sprint 8 (S8-B3, D-118): the ONE map of every seller backend route (every route.ts below apps/seller/backend/src/app/api) and what it needs. Key: "<path below /api> <METHOD>".
 *
 *   a capability   a route that serves a store: it passes that capability to resolveStoreAccess / resolveOwnedStoreId / loadOwnedStore, so the OWNER and an ACTIVE member whose
 *                  role has it pass, and nobody else (a stranger, an invited, disabled or removed member: 403)
 *   'account'      a signed-in user, not tied to a store (their own account, subscription, tickets, the workspace list)
 *   'public'       no session by design: the storefront API, sign in and sign up, the invite preview, health, the unsubscribe link, the Stripe webhook (signed)
 *   'system'       machine to machine (the admin bridge, cron): checked by the internal signature, never a seller session
 *   'owner-only'   a route that reads the store BY OWNER on purpose and is closed to every member (no member can ever pass it)
 *
 * test/route-capabilities.test.ts reads every route file and fails when a route has no entry here, when an entry has no route, or when the file does not call the resolver with
 * the mapped capability. A NEW route file nobody mapped fails it. The per-role tables of the tests are generated from this map, so the table and the code cannot drift.
 */
export type RouteAccess = SellerCapability | 'account' | 'public' | 'system' | 'owner-only';

export const ROUTE_CAPABILITIES: Readonly<Record<string, RouteAccess>> = Object.freeze({
  // alerts
  'alerts GET': 'alerts.read',
  'alerts/[id]/read POST': 'alerts.read',
  'alerts/read-all POST': 'alerts.read',
  'alerts/unread-count GET': 'alerts.read',

  // analytics
  'analytics GET': 'analytics.read',

  // auth
  'auth/forgot-password POST': 'public',
  'auth/resend-verification POST': 'account',
  'auth/reset-password POST': 'public',
  'auth/verify-email POST': 'public',

  // billing
  'billing/checkout POST': 'owner-only',

  // categories
  'categories GET': 'categories.read',
  'categories POST': 'categories.write',
  'categories/[id] DELETE': 'categories.write',
  'categories/[id] GET': 'categories.read',
  'categories/[id] PATCH': 'categories.write',

  // contactMessages
  'contactMessages GET': 'contact.read',
  'contactMessages/[id] GET': 'contact.read',
  'contactMessages/[id] PATCH': 'contact.write',
  'contactMessages/[id]/reply POST': 'contact.write',

  // discounts
  'discounts GET': 'discounts.read',
  'discounts POST': 'discounts.write',
  'discounts/[id] GET': 'discounts.read',
  'discounts/[id] PATCH': 'discounts.write',

  // health
  'health GET': 'public',

  // internal
  'internal/accounts/status POST': 'system',
  'internal/accounts/store-limit POST': 'system',
  'internal/commission/backfill GET': 'system',
  'internal/commission/backfill POST': 'system',
  'internal/commission/report GET': 'system',
  'internal/kpi POST': 'system',
  'internal/media/orphans POST': 'system',
  'internal/moderation/delete POST': 'system',
  'internal/moderation/permanent-delete POST': 'system',
  'internal/moderation/products GET': 'system',
  'internal/moderation/restore POST': 'system',
  'internal/moderation/reviews GET': 'system',
  'internal/moderation/reviews/hide POST': 'system',
  'internal/moderation/reviews/unhide POST': 'system',
  'internal/moderation/takedown POST': 'system',
  'internal/notifications/flush GET': 'system',
  'internal/notifications/flush POST': 'system',
  'internal/orders POST': 'system',
  'internal/orders/detail POST': 'system',
  'internal/payouts GET': 'system',
  'internal/payouts POST': 'system',
  'internal/payouts/balances GET': 'system',
  'internal/payouts/details POST': 'system',
  'internal/payouts/finish POST': 'system',
  'internal/payouts/void POST': 'system',
  'internal/plans/sellers POST': 'system',
  'internal/referrals POST': 'system',
  'internal/referrals/export POST': 'system',
  'internal/retention POST': 'system',
  'internal/retention/admin POST': 'system',
  'internal/retention/run POST': 'system',
  'internal/subscription-payments GET': 'system',
  'internal/subscription-payments/confirm POST': 'system',
  'internal/subscription-payments/reject POST': 'system',
  'internal/subscription-payments/void POST': 'system',
  'internal/subscriptions/expire GET': 'system',
  'internal/subscriptions/expire POST': 'system',
  'internal/support/contact/detail POST': 'system',
  'internal/support/contact/list POST': 'system',
  'internal/support/tickets/detail POST': 'system',
  'internal/support/tickets/list POST': 'system',
  'internal/support/tickets/reply POST': 'system',
  'internal/support/tickets/status POST': 'system',
  'internal/sync/digest POST': 'system',
  // S8-B7: the platform traffic of the admin overview.
  'internal/traffic POST': 'system',
  'internal/sync/receive POST': 'system',

  // inventory
  'inventory GET': 'inventory.read',
  'inventory/adjust POST': 'inventory.write',
  'inventory/history GET': 'inventory.read',

  // media
  'media GET': 'media.read',
  'media POST': 'media.write',
  'media/[id] DELETE': 'media.write',
  'media/[id] PATCH': 'media.write',
  'media/[id]/usage GET': 'media.read',

  // mobile (Sprint 9, EP-31.US01): the phone sign-in is public like users/login; the device list is the caller's own account.
  'mobile/v1/auth/login POST': 'public',
  'mobile/v1/auth/logout POST': 'public',
  'mobile/v1/auth/refresh POST': 'public',
  'mobile/v1/devices GET': 'account',
  'mobile/v1/devices/[id]/revoke POST': 'account',
  'mobile/v1/devices/push-token POST': 'account',
  'mobile/v1/push-settings GET': 'account',
  'mobile/v1/push-settings PATCH': 'account',
  // S9-B4: the phone's data. The same capabilities as the portal routes they stand beside.
  'mobile/v1/alerts GET': 'alerts.read',
  'mobile/v1/alerts/[id]/read POST': 'alerts.read',
  'mobile/v1/alerts/read-all POST': 'alerts.read',
  'mobile/v1/customers GET': 'customers.read',
  'mobile/v1/customers/[key] GET': 'customers.read',
  'mobile/v1/dashboard GET': 'orders.read',
  'mobile/v1/orders GET': 'orders.read',
  'mobile/v1/orders/[id] GET': 'orders.read',
  'mobile/v1/orders/[id]/notes POST': 'orders.notes',
  'mobile/v1/orders/[id]/status POST': 'orders.write',
  'mobile/v1/products GET': 'products.read',
  'mobile/v1/products/[id] GET': 'products.read',
  'mobile/v1/products/[id]/price POST': 'products.write',
  'mobile/v1/products/[id]/stock POST': 'inventory.write',
  'mobile/v1/stores GET': 'account',

  // orders
  'orders GET': 'orders.read',
  'orders/[id] GET': 'orders.read',
  'orders/[id]/cancel POST': 'orders.write',
  'orders/[id]/notes POST': 'orders.notes',
  'orders/[id]/payment POST': 'orders.write',
  'orders/[id]/tracking POST': 'orders.write',
  'orders/[id]/transition POST': 'orders.write',
  'orders/print GET': 'orders.read',

  // plans
  'plans GET': 'account',

  // preview-token
  'preview-token POST': 'products.read',

  // products
  'products GET': 'products.read',
  'products POST': 'products.write',
  'products/[id] DELETE': 'products.write',
  'products/[id] GET': 'products.read',
  'products/[id] PATCH': 'products.write',
  'products/[id]/duplicate POST': 'products.write',
  'products/[id]/publish POST': 'products.write',
  'products/[id]/restore POST': 'products.write',
  'products/[id]/unpublish POST': 'products.write',
  'products/export GET': 'products.read',
  'products/import POST': 'products.write',

  // referrals
  'referrals GET': 'referrals.read',

  // returns
  'returns GET': 'returns.read',
  'returns/[id] GET': 'returns.read',
  'returns/[id] PATCH': 'returns.write',

  // reviews
  'reviews GET': 'reviews.read',
  'reviews/[id] GET': 'reviews.read',
  'reviews/[id] PATCH': 'reviews.reply',
  'reviews/[id]/reply POST': 'reviews.reply',

  // signup
  'signup POST': 'public',

  // storeArticles
  'storeArticles GET': 'content.read',
  'storeArticles POST': 'content.write',
  'storeArticles/[id] DELETE': 'content.write',
  'storeArticles/[id] GET': 'content.read',
  'storeArticles/[id] PATCH': 'content.write',

  // storePages
  'storePages GET': 'content.read',
  'storePages POST': 'content.write',
  'storePages/[id] DELETE': 'content.write',
  'storePages/[id] GET': 'content.read',
  'storePages/[id] PATCH': 'content.write',
  'storePages/from-template POST': 'content.write',

  // storefront
  'storefront/v1/contact POST': 'public',
  // S8-B6: the anonymous counters; no session, no cookie.
  'storefront/v1/events POST': 'public',
  'storefront/v1/stores/[id]/abandoned-cart PUT': 'public',
  'storefront/v1/stores/[id]/articles GET': 'public',
  'storefront/v1/stores/[id]/articles/[slug] GET': 'public',
  'storefront/v1/stores/[id]/cart/quote POST': 'public',
  'storefront/v1/stores/[id]/categories GET': 'public',
  'storefront/v1/stores/[id]/contact POST': 'public',
  'storefront/v1/stores/[id]/orders POST': 'public',
  'storefront/v1/stores/[id]/orders/[number]/return-eligibility GET': 'public',
  'storefront/v1/stores/[id]/orders/[number]/returns POST': 'public',
  'storefront/v1/stores/[id]/orders/[number]/review-eligibility GET': 'public',
  'storefront/v1/stores/[id]/orders/[number]/reviews POST': 'public',
  'storefront/v1/stores/[id]/orders/confirmation POST': 'public',
  'storefront/v1/stores/[id]/orders/lookup POST': 'public',
  'storefront/v1/stores/[id]/orders/track POST': 'public',
  'storefront/v1/stores/[id]/pages GET': 'public',
  'storefront/v1/stores/[id]/pages/[slug] GET': 'public',
  'storefront/v1/stores/[id]/products GET': 'public',
  'storefront/v1/stores/[id]/products/[slug] GET': 'public',
  'storefront/v1/stores/[id]/products/[slug]/reviews GET': 'public',
  'storefront/v1/stores/by-key/[key] GET': 'public',

  // stores
  'stores GET': 'account',
  'stores POST': 'account',
  'stores/[id] GET': 'store.view',
  'stores/[id] PATCH': 'settings.write',
  'stores/[id]/abandoned-carts GET': 'abandoned_carts.manage',
  'stores/[id]/api-keys GET': 'api_keys.manage',
  'stores/[id]/api-keys POST': 'api_keys.manage',
  'stores/[id]/api-keys/[keyId]/revoke POST': 'api_keys.manage',
  'stores/[id]/abandoned-carts/[cartId] DELETE': 'abandoned_carts.manage',
  'stores/[id]/abandoned-carts/[cartId] PATCH': 'abandoned_carts.manage',
  'stores/[id]/blocklist GET': 'blocklist.manage',
  'stores/[id]/blocklist POST': 'blocklist.manage',
  'stores/[id]/blocklist/[contactId] DELETE': 'blocklist.manage',
  'stores/[id]/branding/[kind] POST': 'settings.write',
  'stores/[id]/broadcast GET': 'broadcast.manage',
  'stores/[id]/broadcast POST': 'broadcast.manage',
  'stores/[id]/broadcast/preview POST': 'broadcast.manage',
  'stores/[id]/commission GET': 'commission.read',
  'stores/[id]/customers GET': 'customers.read',
  'stores/[id]/customers/[key] GET': 'customers.read',
  'stores/[id]/customers/[key]/addresses GET': 'customers.read',
  'stores/[id]/customers/[key]/note PATCH': 'customers.write',
  'stores/[id]/customers/export GET': 'customers.export',
  'stores/[id]/domain GET': 'settings.domain',
  'stores/[id]/domain/connect POST': 'settings.domain',
  'stores/[id]/domain/disconnect POST': 'settings.domain',
  'stores/[id]/domain/verify POST': 'settings.domain',
  'stores/[id]/earnings GET': 'earnings.read',
  'stores/[id]/go-live POST': 'go_live',
  'stores/[id]/orders/[orderId]/confirmation POST': 'orders.write',
  'stores/[id]/plan-usage GET': 'billing.manage',
  'stores/[id]/readiness GET': 'settings.read',
  // S8-B7: the sales report CSV (owner and manager).
  'stores/[id]/reports/sales GET': 'analytics.read',
  'stores/[id]/returns GET': 'returns.read',
  'stores/[id]/returns/[returnId] GET': 'returns.read',
  'stores/[id]/returns/[returnId]/approve POST': 'returns.write',
  'stores/[id]/returns/[returnId]/receive POST': 'returns.write',
  'stores/[id]/returns/[returnId]/refund POST': 'returns.refund',
  'stores/[id]/returns/[returnId]/reject POST': 'returns.write',
  'stores/[id]/settings GET': 'store.view',
  'stores/[id]/team GET': 'team.manage',
  'stores/[id]/team/[memberId] PATCH': 'team.manage',
  'stores/[id]/team/[memberId]/disable POST': 'team.manage',
  'stores/[id]/team/[memberId]/enable POST': 'team.manage',
  'stores/[id]/team/[memberId]/remove POST': 'team.manage',
  'stores/[id]/team/[memberId]/resend POST': 'team.manage',
  'stores/[id]/team/invite POST': 'team.manage',

  // subscription
  'subscription GET': 'account',
  'subscription/cancel POST': 'account',
  'subscription/downgrade POST': 'account',
  'subscription/instructions GET': 'account',
  'subscription/payments POST': 'account',
  'subscription/payments/claim POST': 'account',

  // team
  'team/accept POST': 'account',
  'team/invite GET': 'public',

  // themes
  'themes GET': 'account',

  // tickets
  'tickets GET': 'account',
  'tickets POST': 'account',
  'tickets/[id] GET': 'account',
  'tickets/[id]/close POST': 'account',
  'tickets/[id]/reply POST': 'account',

  // unsubscribe
  'unsubscribe POST': 'public',

  // users
  'users/login POST': 'public',
  'users/me GET': 'account',
  'users/me PATCH': 'account',
  'users/me/email POST': 'account',
  'users/me/notification-prefs GET': 'account',
  'users/me/notification-prefs PATCH': 'account',
  'users/me/password POST': 'account',
  'users/me/sessions/revoke-others POST': 'account',

  // v1: the read-only public API (S8-B5). No session by design: each route checks an API key itself (lib/api-v1.ts) and serves that key's store only.
  'v1/orders GET': 'public',
  'v1/orders/[id] GET': 'public',
  'v1/products GET': 'public',
  'v1/products/[id] GET': 'public',

  // webhooks
  'webhooks/stripe-orders POST': 'public',

  // workspace
  'workspace GET': 'account',
  'workspace/stores GET': 'account',
  'workspace/stores POST': 'account',
});

export const NON_STORE_ACCESS = ['account', 'public', 'system', 'owner-only'] as const;

export function isCapabilityAccess(access: RouteAccess): access is SellerCapability {
  return !(NON_STORE_ACCESS as readonly string[]).includes(access);
}

/** Whether a role may call a route, per the map. Unmapped, or not a store route, is false for a role (only a capability route can be reached by a member). */
export function roleMayCall(role: SellerRole, key: string): boolean {
  const access = ROUTE_CAPABILITIES[key];
  if (access === undefined || !isCapabilityAccess(access)) return false;
  return sellerCan(role, access);
}

/** Every role that may call a route (owner first). */
export function rolesForRoute(key: string): SellerRole[] {
  return SELLER_ROLES.filter((role) => roleMayCall(role, key));
}

/** The map as [key, access] rows, sorted. */
export function routeEntries(): Array<[string, RouteAccess]> {
  return Object.entries(ROUTE_CAPABILITIES).sort(([a], [b]) => a.localeCompare(b));
}
