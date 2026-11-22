
// Policy matrix: the single declaration of who may read or write what.
//
// Allowlists are taken from the Payload access blocks in the reference
// (apps/admin/src/collections/*.ts and globals/*.ts). Anything not declared
// here is denied. Seller-owned collections that are still undeclared
// (broadcastLogs, customers) make can() throw PolicyConfigError until their
// field lists are captured.

export type Actor = 'admin' | 'seller' | 'system' | 'public';
export type Operation = 'read' | 'create' | 'update' | 'delete';
export type FieldAllowlist = readonly string[] | '*';
export type FieldPolicy = FieldAllowlist | Partial<Record<Actor, FieldAllowlist>>;

export interface PolicyRule {
readonly actors: readonly Actor[];
readonly fields: FieldPolicy;
}

export interface CollectionPolicy {
readonly read: PolicyRule;
readonly create: PolicyRule;
readonly update: PolicyRule;
readonly delete: PolicyRule;
}

// Blueprint v3 section 1.2, store.operations: what a seller may write.
// Sprint 4 EP-04.US03 (D-088): payoutDetails too. It is not in SELLER_STORE_READABLE_FIELDS: a seller reads it masked only.
export const SELLER_STORE_WRITABLE_FIELDS = ['name', 'storefront', 'paymentSettings', 'courierSettings', 'payoutDetails'] as const;

// Payload STORE_STAFF_WRITABLE_FIELDS (apps/admin/src/collections/Stores.ts).
export const ADMIN_STORE_WRITABLE_FIELDS = [
'owner', 'status', 'suspensionReason', 'suspensionNote', 'suspendedAt', 'statusChangedAt',
'commissionMode', 'commissionRate', 'domain', 'customDomainStatus', 'archivedAt',
] as const;

// What a seller may read of their own store: no commission, owner, or billing internals.
export const SELLER_STORE_READABLE_FIELDS = [
'name', 'slug', 'internalHandle', 'status', 'isThemeDemo', 'domain', 'customDomainStatus',
'storefront', 'paymentSettings', 'courierSettings',
] as const;

// What an anonymous storefront may read, the same subset the Phase 1 projection exposes.
export const PUBLIC_STORE_READABLE_FIELDS = ['name', 'slug', 'internalHandle', 'status', 'isThemeDemo', 'storefront'] as const;

// Payload SELLER_STAFF_WRITABLE_FIELDS (apps/admin/src/collections/Sellers.ts).
export const ADMIN_SELLER_WRITABLE_FIELDS = ['accountStatus', 'storeLimitOverride'] as const;

// Staff user administration. passwordHash is never writable through a generic update.
// storeLimitOverride (Sprint 6) is read here; it is written only through the sellers collection (ADMIN_SELLER_WRITABLE_FIELDS).
// S6-B6: an admin never writes `role` through the generic users row (privilege escalation). Admin accounts are managed through adminUsers, owner level only.
export const ADMIN_USER_READABLE_FIELDS = ['name', 'email', 'role', 'store', 'storeLimitOverride', 'adminLevel', 'createdAt', 'updatedAt'] as const;
export const ADMIN_USER_CREATABLE_FIELDS = ['name', 'email', 'store'] as const;
export const ADMIN_USER_WRITABLE_FIELDS = ['name', 'store'] as const;

// Sprint 6 (S6-B6, D-118): the admin accounts. The routes require the users.manage capability (owner level) for every write; this row says what may be written.
export const ADMIN_ACCOUNT_READABLE_FIELDS = ['name', 'email', 'adminLevel', 'accountStatus', 'emailVerifiedAt', 'createdAt', 'updatedAt'] as const;
export const ADMIN_ACCOUNT_INVITABLE_FIELDS = ['name', 'email', 'adminLevel'] as const;
export const ADMIN_ACCOUNT_WRITABLE_FIELDS = ['adminLevel', 'accountStatus', 'suspensionReason'] as const;

// Commission ledger as the supervisor may read it: totals only, no order identifiers
// (Payload CommissionLedger fields minus orderId, sellerOrderDocId, stripePaymentIntentId, applicationFeeId).
export const ADMIN_LEDGER_READABLE_FIELDS = [
'store', 'orderAmount', 'commissionRate', 'commissionAmount', 'status',
'paymentMethod', 'settlementDate', 'settlementRef', 'createdAt',
] as const;

// Payload PlatformSettings: settingsRevision has update access false, so it is excluded.
export const ADMIN_PLATFORM_SETTINGS_WRITABLE_FIELDS = [
'defaultCommissionRate', 'maxStoresPerSeller', 'stripeCommissionNote', 'storeApprovalRequired',
// Sprint 6 (D-116, D-118): the COD commission percent and the plan settings.
'codCommissionPercent', 'paymentInstructions', 'graceDays', 'trialDays', 'supportEmail', 'supportPhone',
] as const;

// Sprint 6 EP-14 (D-118): subscription plans are data. What a seller (or the public) may read of a plan: the plan facts, never the Stripe
// price id, the revision or the archive data. The admin creates, edits and archives; the revision is moved by the server (system) only.
export const PUBLIC_PLAN_READABLE_FIELDS = ['key', 'name', 'priceRs', 'interval', 'limits', 'features', 'sortOrder', 'isActive'] as const;
export const ADMIN_PLAN_CREATABLE_FIELDS = ['key', 'name', 'priceRs', 'interval', 'limits', 'features', 'sortOrder', 'stripePriceId', 'isActive'] as const;
// The key never changes after creation, and archivedAt/isActive are how a plan is archived (there is no delete).
export const ADMIN_PLAN_WRITABLE_FIELDS = ['name', 'priceRs', 'limits', 'features', 'sortOrder', 'stripePriceId', 'isActive', 'archivedAt'] as const;

// Sprint 6 EP-14 (D-118): a seller's subscription. A seller reads their OWN (the route scopes it to the signed-in user: a policy row cannot say
// "own"); an admin creates and changes it (manual payment marked paid, a trial, a cancel); the revision and the expiry are moved by the system.
export const SELLER_SUBSCRIPTION_READABLE_FIELDS = ['planKey', 'status', 'periodStart', 'currentPeriodEnd', 'graceUntil', 'trialEndsAt', 'source', 'cancelAtPeriodEnd', 'pendingPlanKey'] as const;
export const ADMIN_SUBSCRIPTION_CREATABLE_FIELDS = ['seller', 'planKey', 'status', 'periodStart', 'currentPeriodEnd', 'graceUntil', 'trialEndsAt', 'source', 'cancelAtPeriodEnd'] as const;
// The seller never changes (one subscription per seller); revision is the server's.
export const ADMIN_SUBSCRIPTION_WRITABLE_FIELDS = ['planKey', 'status', 'periodStart', 'currentPeriodEnd', 'graceUntil', 'trialEndsAt', 'source', 'cancelAtPeriodEnd'] as const;

// Sprint 6 (S6-B4, D-118): a manual subscription payment. A seller reads and creates their OWN (the route scopes by the signed-in user; a policy
// row cannot say "own"), and says "I paid" (method, reference, proof, the claimed status). Only the planKey comes from the seller: the amount is the
// plan's price, written by the server (system). An admin reads everything and decides (status, who, when, why, the period); nobody deletes.
export const SELLER_PAYMENT_READABLE_FIELDS = ['planKey', 'amountRs', 'periodStart', 'periodEnd', 'method', 'reference', 'proofUrl', 'status', 'reason', 'claimedAt', 'decidedAt'] as const;
export const SELLER_PAYMENT_CREATABLE_FIELDS = ['planKey'] as const;
export const SELLER_PAYMENT_WRITABLE_FIELDS = ['method', 'reference', 'proofUrl', 'status', 'claimedAt'] as const;
export const ADMIN_PAYMENT_WRITABLE_FIELDS = ['status', 'decidedBy', 'decidedAt', 'reason', 'periodStart', 'periodEnd'] as const;

// Sprint 6 (S6-B5): the safe fields of the admin's read-only orders view (adminOrdersView row below).
export const ADMIN_ORDERS_VIEW_FIELDS = ['orderNumber', 'store', 'storeName', 'status', 'paymentMethod', 'total', 'city', 'createdAt', 'updatedAt', 'itemCount', 'items', 'totals', 'statusHistory', 'paymentStatus', 'confirmationStatus'] as const;

// What a seller may set on a category of their store. store and isDemo are never client-writable.
export const SELLER_CATEGORY_WRITABLE_FIELDS = ['name', 'slug', 'order', 'description'] as const;

// What an anonymous storefront may read of a category.
export const PUBLIC_CATEGORY_READABLE_FIELDS = ['name', 'slug', 'order', 'description', 'banner'] as const;

// What a seller may set on a product of their store. store, isPublished, isDemo and every derived field (minPrice,
// ratings, counts) are never client-writable. Stock of an existing variant has its own rule: see D-034.
export const SELLER_PRODUCT_WRITABLE_FIELDS = [
'title', 'slug', 'description', 'highlights', 'tags', 'categories', 'media', 'videos', 'options', 'variants',
'deliveryCharge', 'isFeatured', 'hideWhenOutOfStock', 'seoTitle', 'seoDescription', 'seoImage',
] as const;

// What an anonymous storefront may read of a published product.
export const PUBLIC_PRODUCT_READABLE_FIELDS = [
'title', 'slug', 'description', 'highlights', 'tags', 'categories', 'media', 'videos', 'options', 'variants', 'minPrice',
'deliveryCharge', 'avgRating', 'reviewCount', 'seoTitle', 'seoDescription', 'seoImage',
] as const;

/**
 * EP-02: each order action and the (operation, row) that guards it. Routes call
 * assertCan(actor, ORDER_ACTIONS.cancel.operation, ORDER_ACTIONS.cancel.collection, fields) and then scope the order
 * to the verified store.
 */
export const ORDER_ACTIONS = {
view: { operation: 'read', collection: 'orderView' },
transition: { operation: 'update', collection: 'orderTransition' },
cancel: { operation: 'update', collection: 'orderCancel' },
note: { operation: 'create', collection: 'orderNotes' },
payment: { operation: 'update', collection: 'orderPayment' },
print: { operation: 'read', collection: 'orderPrint' },
// EP-02 OB-4: editing courier and tracking of a dispatched order.
tracking: { operation: 'update', collection: 'orderTracking' },
} as const satisfies Record<string, { operation: Operation; collection: string }>;
export type OrderAction = keyof typeof ORDER_ACTIONS;

export const POLICY_MATRIX: Readonly<Record<string, CollectionPolicy>> = {
stores: {
read: {
actors: ['admin', 'system', 'seller', 'public'],
fields: {
admin: '*',
system: '*',
seller: SELLER_STORE_READABLE_FIELDS,
public: PUBLIC_STORE_READABLE_FIELDS,
},
},
create: { actors: ['admin', 'system'], fields: { admin: '*', system: '*' } },
update: {
actors: ['admin', 'seller', 'system'],
fields: {
admin: ADMIN_STORE_WRITABLE_FIELDS,
seller: SELLER_STORE_WRITABLE_FIELDS,
system: '*',
},
},
delete: { actors: ['admin', 'system'], fields: '*' },
},

users: {
read: { actors: ['admin', 'system'], fields: { admin: ADMIN_USER_READABLE_FIELDS, system: '*' } },
create: { actors: ['admin', 'system'], fields: { admin: ADMIN_USER_CREATABLE_FIELDS, system: '*' } },
update: { actors: ['admin', 'system'], fields: { admin: ADMIN_USER_WRITABLE_FIELDS, system: '*' } },
delete: { actors: ['admin', 'system'], fields: '*' },
},

sellers: {
read: { actors: ['admin', 'system'], fields: '*' },
create: { actors: ['system'], fields: '*' },
update: { actors: ['admin', 'system'], fields: { admin: ADMIN_SELLER_WRITABLE_FIELDS, system: '*' } },
delete: { actors: ['system'], fields: '*' },
},

commissionLedger: {
read: { actors: ['admin', 'system'], fields: { admin: ADMIN_LEDGER_READABLE_FIELDS, system: '*' } },
create: { actors: ['system'], fields: '*' },
update: { actors: ['system'], fields: '*' },
delete: { actors: ['system'], fields: '*' },
},

platformSettings: {
read: { actors: ['admin', 'system'], fields: '*' },
create: { actors: [], fields: '*' },
update: {
actors: ['admin', 'system'],
fields: { admin: ADMIN_PLATFORM_SETTINGS_WRITABLE_FIELDS, system: '*' },
},
delete: { actors: [], fields: '*' },
},

subscriptions: {
// Seller: own only (the route filters by the signed-in user). The public reads none.
read: { actors: ['seller', 'admin', 'system'], fields: { seller: SELLER_SUBSCRIPTION_READABLE_FIELDS, admin: '*', system: '*' } },
create: { actors: ['admin', 'system'], fields: { admin: ADMIN_SUBSCRIPTION_CREATABLE_FIELDS, system: '*' } },
update: { actors: ['admin', 'system'], fields: { admin: ADMIN_SUBSCRIPTION_WRITABLE_FIELDS, system: '*' } },
// A subscription is never deleted: it expires or is cancelled and stays as the record.
delete: { actors: [], fields: '*' },
},

subscriptionPayments: {
read: { actors: ['seller', 'admin', 'system'], fields: { seller: SELLER_PAYMENT_READABLE_FIELDS, admin: '*', system: '*' } },
create: { actors: ['seller', 'system'], fields: { seller: SELLER_PAYMENT_CREATABLE_FIELDS, system: '*' } },
update: { actors: ['seller', 'admin', 'system'], fields: { seller: SELLER_PAYMENT_WRITABLE_FIELDS, admin: ADMIN_PAYMENT_WRITABLE_FIELDS, system: '*' } },
// A payment is a record of money: it is voided or rejected, never deleted.
delete: { actors: [], fields: '*' },
},

adminUsers: {
read: { actors: ['admin', 'system'], fields: { admin: ADMIN_ACCOUNT_READABLE_FIELDS, system: '*' } },
create: { actors: ['admin', 'system'], fields: { admin: ADMIN_ACCOUNT_INVITABLE_FIELDS, system: '*' } },
update: { actors: ['admin', 'system'], fields: { admin: ADMIN_ACCOUNT_WRITABLE_FIELDS, system: '*' } },
// An admin account is disabled, never deleted: the audit trail keeps pointing at it.
delete: { actors: [], fields: '*' },
},

// Sprint 6 (S6-B5): the admin's READ-ONLY view of orders: safe fields only (no name, phone, address or email). The old `orders` row still lets an
// admin read everything (D-067, CO-32); the admin console's orders and analytics paths use THIS row instead. Nobody writes through it.
adminOrdersView: {
read: { actors: ['admin', 'system'], fields: { admin: ADMIN_ORDERS_VIEW_FIELDS, system: ADMIN_ORDERS_VIEW_FIELDS } },
create: { actors: [], fields: '*' },
update: { actors: [], fields: '*' },
delete: { actors: [], fields: '*' },
},

// Audit entries are immutable: even system may not update or delete them.
// Payload allowed systemOnly update and delete; this is an intentional tightening.
'audit-log': {
read: { actors: ['admin', 'system'], fields: '*' },
create: { actors: ['system'], fields: '*' },
update: { actors: [], fields: '*' },
delete: { actors: [], fields: '*' },
},

// Categories belong to one store. A seller manages their own; which store that is, the route decides. Admin may only
// read (D-006), and the storefront reads the public fields. Everything else is denied, system included.
categories: {
read: {
actors: ['seller', 'admin', 'public'],
fields: { seller: '*', admin: '*', public: PUBLIC_CATEGORY_READABLE_FIELDS },
},
create: { actors: ['seller'], fields: { seller: SELLER_CATEGORY_WRITABLE_FIELDS } },
update: { actors: ['seller'], fields: { seller: SELLER_CATEGORY_WRITABLE_FIELDS } },
delete: { actors: ['seller'], fields: { seller: '*' } },
},

// Products belong to one store. A seller manages their own; which store that is, the route decides. Admin may only
// read for now (D-002: moderation arrives with its own routes), and the storefront reads published products.
products: {
read: {
actors: ['seller', 'admin', 'public'],
fields: { seller: '*', admin: '*', public: PUBLIC_PRODUCT_READABLE_FIELDS },
},
create: { actors: ['seller'], fields: { seller: SELLER_PRODUCT_WRITABLE_FIELDS } },
update: { actors: ['seller'], fields: { seller: SELLER_PRODUCT_WRITABLE_FIELDS } },
delete: { actors: ['seller'], fields: { seller: '*' } },
},

// What happens to a product as a whole, kept apart from the edits above so isPublished stays out of a PATCH. update is
// publish, unpublish and restore. delete is the permanent delete: a seller's from trash, system's from the retention job.
productLifecycle: {
read: { actors: [], fields: {} },
create: { actors: [], fields: {} },
update: { actors: ['seller'], fields: { seller: ['isPublished', 'deletedAt'] } },
delete: { actors: ['seller', 'system'], fields: { seller: '*', system: '*' } },
},

// Stock of existing variants (D-034). update is the adjust endpoint, the only way that stock changes; read is the
// inventory list and the stock history. A movement is never edited or removed.
inventory: {
read: { actors: ['seller'], fields: { seller: '*' } },
create: { actors: [], fields: {} },
update: { actors: ['seller'], fields: { seller: ['stockQuantity'] } },
delete: { actors: [], fields: {} },
},

// Bulk import and export of a store's products. Only the owner: an admin reads products through moderation, and never
// writes them (D-002). read is the export, create is the import, which also updates what it matches.
productBulk: {
read: { actors: ['seller'], fields: { seller: '*' } },
create: { actors: ['seller'], fields: { seller: '*' } },
update: { actors: [], fields: {} },
delete: { actors: [], fields: {} },
},

// EP-02 order actions, one row each, in the style of productLifecycle and inventory. Only the store owner (actor
// 'seller') acts on orders in this epic; which store, the route decides (the order is read with { _id, store } for the
// verified store, so another store's order is a 404). Admin and system have no row here (fail-closed). The older
// 'orders' row further down (B10.4) is left as it was. The field lists name what the client may supply; statusHistory,
// notes[].by, the timestamps and every other derived field are written by the server only.
//   view       read    list, detail, per-status counts
//   transition update  confirm, processing, dispatch (courier and tracking), delivered, and a tracking edit after dispatch; note is the optional history note (OB-2)
//   cancel     update  cancel with a reason and an optional history note (OB-3: the request keys reason, note); the
//                      status, cancelReason, cancelledAt and the stock restore are the server's
//   note       create  add an internal note; read lists them
//   payment    update  mark COD collected with the amount
//   print      read    shipping label, packing slip, bulk print
orderView: {
read: { actors: ['seller'], fields: { seller: '*' } },
create: { actors: [], fields: {} },
update: { actors: [], fields: {} },
delete: { actors: [], fields: {} },
},

orderTransition: {
read: { actors: [], fields: {} },
create: { actors: [], fields: {} },
update: { actors: ['seller'], fields: { seller: ['status', 'note', 'courier', 'trackingNumber', 'trackingUrl'] } },
delete: { actors: [], fields: {} },
},

// Sprint 5 EP-11.US01 (D-107): the seller confirms, marks unreachable or cancels an unconfirmed COD order. Seller only: an admin never
// decides for a store. Not in ORDER_ACTIONS (the route calls assertCan on this row directly, as the customer note route does).
orderConfirmation: {
read: { actors: [], fields: {} },
create: { actors: [], fields: {} },
update: { actors: ['seller'], fields: { seller: ['result', 'note'] } },
delete: { actors: [], fields: {} },
},

orderCancel: {
read: { actors: [], fields: {} },
create: { actors: [], fields: {} },
// system: a Stripe event cancelling an unpaid card order (D-082).
update: { actors: ['seller', 'system'], fields: { seller: ['reason', 'note'], system: ['reason', 'note'] } },
delete: { actors: [], fields: {} },
},

orderNotes: {
read: { actors: ['seller'], fields: { seller: '*' } },
create: { actors: ['seller'], fields: { seller: ['text'] } },
update: { actors: [], fields: {} },
delete: { actors: [], fields: {} },
},

orderPayment: {
read: { actors: [], fields: {} },
create: { actors: [], fields: {} },
// system: a Stripe event marking a card order paid (D-082).
update: { actors: ['seller', 'system'], fields: { seller: ['amount'], system: ['paymentStatus', 'paidAt'] } },
delete: { actors: [], fields: {} },
},

// EP-02 OB-4: the tracking edit after dispatch (POST /api/orders/:id/tracking). Store owner only; admin and system denied.
orderTracking: {
read: { actors: [], fields: {} },
create: { actors: [], fields: {} },
update: { actors: ['seller'], fields: { seller: ['courier', 'trackingNumber', 'trackingUrl'] } },
delete: { actors: [], fields: {} },
},

orderPrint: {
read: { actors: ['seller'], fields: { seller: '*' } },
create: { actors: [], fields: {} },
update: { actors: [], fields: {} },
delete: { actors: [], fields: {} },
},

// Admin moderation of products (D-002, D-026). read is the cross-store list, update is takedown and restore, delete is the
// admin delete and the permanent delete. It is a row of its own so an admin still cannot edit a product (products above).
productModeration: {
read: { actors: ['admin'], fields: { admin: '*' } },
create: { actors: [], fields: {} },
update: { actors: ['admin'], fields: { admin: '*' } },
delete: { actors: ['admin'], fields: { admin: '*' } },
},

// A preview link of a store (D-018, D-019). create is the click on "Preview store". Only the store's owner previews in
// this epic (D-042), so an admin has no row here even though an admin can read the store. Nothing else exists to do to a
// link: it is signed, not stored.
storePreview: {
read: { actors: [], fields: {} },
create: { actors: ['seller'], fields: { seller: '*' } },
update: { actors: [], fields: {} },
delete: { actors: [], fields: {} },
},

// Reviews of permanently deleted products (D-014, A-004). Only the delete step writes them, and nobody changes them.
archivedReviews: {
read: { actors: ['admin', 'system'], fields: { admin: '*', system: '*' } },
create: { actors: ['system'], fields: { system: '*' } },
update: { actors: [], fields: {} },
delete: { actors: [], fields: {} },
},

subscriptionPlans: {
// Sprint 6: a seller reads the public view (GET /api/plans); the anonymous storefront may too (pricing). Admin and system read everything.
read: {
actors: ['public', 'seller', 'admin', 'system'],
fields: { public: PUBLIC_PLAN_READABLE_FIELDS, seller: PUBLIC_PLAN_READABLE_FIELDS, admin: '*', system: '*' },
},
create: { actors: ['admin', 'system'], fields: { admin: ADMIN_PLAN_CREATABLE_FIELDS, system: '*' } },
update: { actors: ['admin', 'system'], fields: { admin: ADMIN_PLAN_WRITABLE_FIELDS, system: '*' } },
// Archiving (update isActive false) is the only removal: nobody deletes a plan, system included.
delete: { actors: [], fields: '*' },
},

// The outbox is written only by server-side services running as 'system'.
// A seller must never be able to enqueue sync envelopes through an API route.
'sync-outbox': {
read: { actors: ['admin', 'system'], fields: '*' },
create: { actors: ['system'], fields: '*' },
update: { actors: ['system'], fields: '*' },
delete: { actors: ['system'], fields: '*' },
},
};

// B10.0 declarations. Sellers may create and update their store's discounts. Sprint 5 EP-21 (D-108): a seller no longer changes a review's
// status (the admin hides and shows reviews); the seller keeps only the reply. Deletes are admin and system only. Creating a review is
// system-only (the public review route writes it as the system actor).
export const SELLER_REVIEW_UPDATABLE_FIELDS = ['reply'] as const;
Object.assign(POLICY_MATRIX, {
  discounts: {
    read: { actors: ['admin', 'system', 'seller'], fields: { admin: '*', system: '*', seller: '*' } },
    create: {
      actors: ['admin', 'system', 'seller'],
      fields: {
        admin: '*',
        system: '*',
        seller: ['code', 'type', 'value', 'minOrderAmount', 'maxUses', 'startDate', 'endDate', 'applicableProducts', 'isActive'],
      },
    },
    update: {
      actors: ['admin', 'system', 'seller'],
      fields: { admin: '*', system: '*', seller: ['value', 'minOrderAmount', 'maxUses', 'startDate', 'endDate', 'isActive', 'archivedAt'] },
    },
    delete: { actors: ['admin', 'system'], fields: '*' },
  },
  reviews: {
    read: { actors: ['admin', 'system', 'seller'], fields: { admin: '*', system: '*', seller: '*' } },
    create: { actors: ['system'], fields: { system: '*' } },
    update: { actors: ['admin', 'system', 'seller'], fields: { admin: '*', system: '*', seller: SELLER_REVIEW_UPDATABLE_FIELDS } },
    delete: { actors: ['admin', 'system'], fields: '*' },
  },
});

// B10.2 declarations. A seller reads their store's returns and changes only status, refundType, and
// refundAmount on one (ID-24). Referrals are read-only for sellers: the reward fields are admin-only (ID-25).
Object.assign(POLICY_MATRIX, {
  returns: {
    read: { actors: ['admin', 'system', 'seller'], fields: { admin: '*', system: '*', seller: '*' } },
    create: { actors: ['system'], fields: { system: '*' } },
    update: {
      actors: ['admin', 'system', 'seller'],
      fields: { admin: '*', system: '*', seller: ['status', 'refundType', 'refundAmount'] },
    },
    delete: { actors: ['admin', 'system'], fields: '*' },
  },
  referrals: {
    read: { actors: ['admin', 'system', 'seller'], fields: { admin: '*', system: '*', seller: '*' } },
    create: { actors: ['system'], fields: { system: '*' } },
    update: { actors: ['admin', 'system'], fields: { admin: '*', system: '*' } },
    delete: { actors: ['admin', 'system'], fields: '*' },
  },
});

// B10.3 declarations. A seller may create a media record for their store, supplying alt only (ID-23). Update stays
// with the system; delete with admin and system.
Object.assign(POLICY_MATRIX, {
  media: {
    read: { actors: ['admin', 'system', 'seller'], fields: { admin: '*', system: '*', seller: '*' } },
    create: { actors: ['system', 'seller'], fields: { system: '*', seller: ['alt'] } },
    // Sprint 7 (S7-B1): a seller renames a file of their own store (PATCH /api/media/:id). The name is the only field: never the url, the
    // alt text, the store or the Cloudinary id. The admin has no media update.
    update: { actors: ['system', 'seller'], fields: { system: '*', seller: ['name'] } },
    // Sprint 4 CO-09: a seller deletes their own store's media (DELETE /api/media/:id, 409 while in use).
    delete: { actors: ['admin', 'system', 'seller'], fields: '*' },
  },
});

// B10.4 declarations, added only where the matrix does not already declare the collection. Sellers read their
// store's orders (writes: system and admin only, as in Payload); since Sprint 7 they also write their store's articles.
export const SELLER_ARTICLE_FIELDS = ['type', 'title', 'slug', 'excerpt', 'content', 'coverImage', 'status', 'tags', 'seoTitle', 'seoDescription'] as const;
// Sprint 7 (S7-B3): the fields of a static page a seller may write (the contract's PAGE_WRITE_FIELDS).
export const SELLER_PAGE_FIELDS = ['title', 'slug', 'body', 'status', 'showInFooter', 'sortOrder'] as const;
{
  const declarations: Record<string, unknown> = {
    // Sprint 7 (S7-B2, CO-116): a seller writes the articles of their own store, through an explicit field list. The store, the publish date, the
    // revision and the media references are set by the server, never by the body. The admin and the system keep what they had.
    storeArticles: {
      read: { actors: ['admin', 'system', 'seller'], fields: { admin: '*', system: '*', seller: '*' } },
      create: { actors: ['system', 'seller'], fields: { system: '*', seller: [...SELLER_ARTICLE_FIELDS] } },
      update: { actors: ['admin', 'system', 'seller'], fields: { admin: '*', system: '*', seller: [...SELLER_ARTICLE_FIELDS] } },
      delete: { actors: ['admin', 'system', 'seller'], fields: '*' },
    },
    orders: {
      read: { actors: ['admin', 'system', 'seller'], fields: { admin: '*', system: '*', seller: '*' } },
      create: { actors: ['system'], fields: { system: '*' } },
      update: { actors: ['admin', 'system'], fields: { admin: '*', system: '*' } },
      delete: { actors: ['admin', 'system'], fields: '*' },
    },
    // Sprint 7 (S7-B3): a seller writes the static pages of their own store, through an explicit field list. The store, the revision, the publish date,
    // the template and the media references are the server's. The admin may read (for moderation) and nothing else.
    storePages: {
      read: { actors: ['admin', 'system', 'seller'], fields: { admin: '*', system: '*', seller: '*' } },
      create: { actors: ['system', 'seller'], fields: { system: '*', seller: [...SELLER_PAGE_FIELDS] } },
      update: { actors: ['system', 'seller'], fields: { system: '*', seller: [...SELLER_PAGE_FIELDS] } },
      delete: { actors: ['system', 'seller'], fields: '*' },
    },
  };
  for (const [name, rule] of Object.entries(declarations)) {
    if (!(name in POLICY_MATRIX)) Object.assign(POLICY_MATRIX, { [name]: rule });
  }
}

// Sprint 4 EP-07.US03: the seller's in-app alerts and their email switches. Only the store owner reads and marks alerts
// (an admin has no row, as for orders, D-067); alerts are written by the system only. The email switches live on the
// seller's own user record and are the only part of it this row opens.
export const SELLER_NOTIFICATION_PREF_FIELDS = ['emailNewOrder', 'emailLowStock'] as const;
Object.assign(POLICY_MATRIX, {
  sellerAlerts: {
    read: { actors: ['seller', 'system'], fields: { seller: '*', system: '*' } },
    create: { actors: ['system'], fields: { system: '*' } },
    update: { actors: ['seller', 'system'], fields: { seller: ['readAt'], system: '*' } },
    delete: { actors: [], fields: {} },
  },
  notificationPrefs: {
    read: { actors: ['seller'], fields: { seller: '*' } },
    create: { actors: [], fields: {} },
    update: { actors: ['seller'], fields: { seller: SELLER_NOTIFICATION_PREF_FIELDS } },
    delete: { actors: [], fields: {} },
  },
});

// Sprint 4 EP-08: the seller's own account (profile, password, email, sessions) and the single-use account tokens.
// A seller changes only their own record, and only these fields. Tokens are written and read by the system only.
// Suspending a seller is the existing sellers row (admin, accountStatus).
export const SELLER_ACCOUNT_WRITABLE_FIELDS = ['name', 'phone', 'password', 'email', 'sessions'] as const;
Object.assign(POLICY_MATRIX, {
  sellerAccount: {
    read: { actors: ['seller'], fields: { seller: '*' } },
    create: { actors: [], fields: {} },
    update: { actors: ['seller'], fields: { seller: SELLER_ACCOUNT_WRITABLE_FIELDS } },
    delete: { actors: [], fields: {} },
  },
  authTokens: {
    read: { actors: ['system'], fields: { system: '*' } },
    create: { actors: ['system'], fields: { system: '*' } },
    update: { actors: ['system'], fields: { system: '*' } },
    delete: { actors: ['system'], fields: { system: '*' } },
  },
});

// Sprint 4 EP-05.US03, US04, US06 (D-088, D-090, D-100): payouts, the full payout account, earnings and the commission report.
//   payouts          read: the admin's balances and history, and the seller's own payout list (only these fields; which store,
//                    the route decides). create is making a payout and update is voiding or finishing one: admin only.
//                    Nobody deletes a payout.
//   payoutDetails    read: the FULL payout account of a store. Admin only, and every read is audited by the route.
//   earnings         read: a seller's own earnings summary and entry list. An admin has no row (the admin console reads the
//                    commission report instead), as for orders (D-067).
//   commissionReport read: the per-store commission report and its CSV. Admin only.
export const SELLER_PAYOUT_READABLE_FIELDS = ['amount', 'method', 'reference', 'status', 'createdAt'] as const;
Object.assign(POLICY_MATRIX, {
  payouts: {
    read: { actors: ['admin', 'seller'], fields: { admin: '*', seller: SELLER_PAYOUT_READABLE_FIELDS } },
    create: { actors: ['admin'], fields: { admin: '*' } },
    update: { actors: ['admin'], fields: { admin: '*' } },
    delete: { actors: [], fields: {} },
  },
  payoutDetails: {
    read: { actors: ['admin'], fields: { admin: '*' } },
    create: { actors: [], fields: {} },
    update: { actors: [], fields: {} },
    delete: { actors: [], fields: {} },
  },
  earnings: {
    read: { actors: ['seller'], fields: { seller: '*' } },
    create: { actors: [], fields: {} },
    update: { actors: [], fields: {} },
    delete: { actors: [], fields: {} },
  },
  commissionReport: {
    read: { actors: ['admin'], fields: { admin: '*' } },
    create: { actors: [], fields: {} },
    update: { actors: [], fields: {} },
    delete: { actors: [], fields: {} },
  },
});

// Sprint 4 EP-07.US04 (D-092): a seller's customers and email broadcasts. Seller only, and only of their own store (the route
// checks the store). An admin has no row: the admin console never reads a store's customers or sends in a store's name.
//   customers   read: the store's customers derived from its orders.
//   broadcasts  read: the history and the preview; create: a new broadcast. Nobody updates or deletes one.
Object.assign(POLICY_MATRIX, {
  customers: {
    read: { actors: ['seller'], fields: { seller: '*' } },
    create: { actors: [], fields: {} },
    update: { actors: [], fields: {} },
    delete: { actors: [], fields: {} },
  },
  broadcasts: {
    read: { actors: ['seller'], fields: { seller: '*' } },
    create: { actors: ['seller'], fields: { seller: '*' } },
    update: { actors: [], fields: {} },
    delete: { actors: [], fields: {} },
  },
});

// Sprint 5 EP-10.US02 (D-107): the seller's private note and tags on a customer (CustomerNote). Customers themselves stay the
// read-only derived "customers" row above. Seller only, of their own store (the route checks the store). Nobody creates or
// deletes through the generic policy: the note route is one upsert, so it is an "update" of the customer's note.
Object.assign(POLICY_MATRIX, {
  customerNotes: {
    read: { actors: ['seller'], fields: { seller: '*' } },
    create: { actors: [], fields: {} },
    update: { actors: ['seller'], fields: { seller: ['note', 'tags'] } },
    delete: { actors: [], fields: {} },
  },
});

// Sprint 5 EP-11.US02 (D-107): the phones and emails a store refuses orders from. Seller only, of their own store (the route checks
// the store); an admin has no row. Nobody updates a row: a contact is added or removed.
export const SELLER_BLOCKED_CONTACT_CREATABLE_FIELDS = ['kind', 'value', 'reason'] as const;
Object.assign(POLICY_MATRIX, {
  blockedContacts: {
    read: { actors: ['seller'], fields: { seller: '*' } },
    create: { actors: ['seller'], fields: { seller: SELLER_BLOCKED_CONTACT_CREATABLE_FIELDS } },
    update: { actors: [], fields: {} },
    delete: { actors: ['seller'], fields: { seller: '*' } },
  },
});

// Sprint 5 EP-13 (D-107, D-108): the seller's return actions: approve, reject (with a reason), receive (what came back and what is restocked)
// and record a refund. Each is its own route and its own compare-and-set; the seller never writes the status or the totals directly.
// Seller only, of their own store (the route checks the store); an admin has no row. The generic PATCH on `returns` stays as it was.
export const SELLER_RETURN_ACTION_FIELDS = ['reason', 'items', 'amount', 'method', 'reference'] as const;
Object.assign(POLICY_MATRIX, {
  returnActions: {
    read: { actors: [], fields: {} },
    create: { actors: [], fields: {} },
    update: { actors: ['seller'], fields: { seller: SELLER_RETURN_ACTION_FIELDS } },
    delete: { actors: [], fields: {} },
  },
});

// Sprint 5 EP-28 (D-107): abandoned carts. The public checkout route writes one as the system actor (create and refresh); the store's owner
// reads them, marks one contacted (the status field only: the route allows no other move) and deletes one. An admin has no row.
export const SELLER_ABANDONED_CART_UPDATABLE_FIELDS = ['status'] as const;
Object.assign(POLICY_MATRIX, {
  abandonedCarts: {
    read: { actors: ['seller', 'system'], fields: { seller: '*', system: '*' } },
    create: { actors: ['system'], fields: { system: '*' } },
    update: { actors: ['seller', 'system'], fields: { seller: SELLER_ABANDONED_CART_UPDATABLE_FIELDS, system: '*' } },
    delete: { actors: ['seller', 'system'], fields: { seller: '*', system: '*' } },
  },
});

// Sprint 7 (S7-B4): the contact inbox and the support tickets. A contact message is written by the public form (the system actor), read and answered by the
// store's seller (store scope) or by the admin (platform scope; the admin only reads, replies go through the signed seller call). A ticket is the seller's
// own request to the platform: the seller creates, reads and answers their own, the admin reads and answers by capability (tickets.read, tickets.reply).
export const SELLER_CONTACT_FIELDS = ['status', 'replies'] as const;
export const SELLER_TICKET_FIELDS = ['subject', 'messages', 'store', 'orderRef', 'status'] as const;
Object.assign(POLICY_MATRIX, {
  contactMessages: {
    read: { actors: ['admin', 'system', 'seller'], fields: { admin: '*', system: '*', seller: '*' } },
    create: { actors: ['system'], fields: { system: '*' } },
    update: { actors: ['system', 'seller'], fields: { system: '*', seller: [...SELLER_CONTACT_FIELDS] } },
    delete: { actors: ['system'], fields: '*' },
  },
  tickets: {
    read: { actors: ['admin', 'system', 'seller'], fields: { admin: '*', system: '*', seller: '*' } },
    create: { actors: ['system', 'seller'], fields: { system: '*', seller: [...SELLER_TICKET_FIELDS] } },
    update: { actors: ['admin', 'system', 'seller'], fields: { admin: ['messages', 'status'], system: '*', seller: ['messages', 'status'] } },
    delete: { actors: ['system'], fields: '*' },
  },
});
