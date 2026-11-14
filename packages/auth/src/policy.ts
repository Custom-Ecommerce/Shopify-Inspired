
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
export const ADMIN_USER_READABLE_FIELDS = ['name', 'email', 'role', 'store', 'createdAt', 'updatedAt'] as const;
export const ADMIN_USER_CREATABLE_FIELDS = ['name', 'email', 'role', 'store'] as const;
export const ADMIN_USER_WRITABLE_FIELDS = ['name', 'role', 'store'] as const;

// Commission ledger as the supervisor may read it: totals only, no order identifiers
// (Payload CommissionLedger fields minus orderId, sellerOrderDocId, stripePaymentIntentId, applicationFeeId).
export const ADMIN_LEDGER_READABLE_FIELDS = [
'store', 'orderAmount', 'commissionRate', 'commissionAmount', 'status',
'paymentMethod', 'settlementDate', 'settlementRef', 'createdAt',
] as const;

// Payload PlatformSettings: settingsRevision has update access false, so it is excluded.
export const ADMIN_PLATFORM_SETTINGS_WRITABLE_FIELDS = [
'defaultCommissionRate', 'maxStoresPerSeller', 'stripeCommissionNote', 'storeApprovalRequired',
] as const;

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
read: { actors: ['public', 'admin', 'system'], fields: { public: ['name', 'tier'], admin: '*', system: '*' } },
create: { actors: ['admin', 'system'], fields: '*' },
update: { actors: ['admin', 'system'], fields: '*' },
delete: { actors: ['admin', 'system'], fields: '*' },
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

// B10.0 declarations. Sellers may create and update their store's discounts, and may change only a review's
// status (ID-21). Deletes are admin and system only. Creating a review is system-only (the storefront writes it).
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
    update: { actors: ['admin', 'system', 'seller'], fields: { admin: '*', system: '*', seller: ['status'] } },
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
    update: { actors: ['system'], fields: { system: '*' } },
    // Sprint 4 CO-09: a seller deletes their own store's media (DELETE /api/media/:id, 409 while in use).
    delete: { actors: ['admin', 'system', 'seller'], fields: '*' },
  },
});

// B10.4 declarations, added only where the matrix does not already declare the collection. Sellers read their
// store's articles and orders; writes are system and admin only, as in Payload.
{
  const declarations: Record<string, unknown> = {
    storeArticles: {
      read: { actors: ['admin', 'system', 'seller'], fields: { admin: '*', system: '*', seller: '*' } },
      create: { actors: ['system'], fields: { system: '*' } },
      update: { actors: ['admin', 'system'], fields: { admin: '*', system: '*' } },
      delete: { actors: ['admin', 'system'], fields: '*' },
    },
    orders: {
      read: { actors: ['admin', 'system', 'seller'], fields: { admin: '*', system: '*', seller: '*' } },
      create: { actors: ['system'], fields: { system: '*' } },
      update: { actors: ['admin', 'system'], fields: { admin: '*', system: '*' } },
      delete: { actors: ['admin', 'system'], fields: '*' },
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
