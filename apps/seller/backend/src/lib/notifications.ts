import mongoose from 'mongoose';
import { after } from 'next/server';
import * as notificationsNs from '@markaz/notifications';
import type { EnqueueInput, EnqueueResult, NotificationOutboxModel, TemplateName } from '@markaz/notifications';
import type { SellerAlertKind } from '@markaz/contracts';
import { unwrapCjs } from '@/lib/cjs';
import { readConfirmationStatus, readNotificationPrefs } from '@/lib/contracts';
import { NotificationOutbox, SellerAlert, Store, User } from '@/lib/services';
import { readMessages } from '@/lib/store-settings';

// The package is CommonJS, read through the default object like the other workspace packages (see services.ts).
const notifications: typeof notificationsNs = unwrapCjs(notificationsNs);

/**
 * Sprint 4 EP-07 (D-091): how the seller backend sends messages and writes seller alerts. Every entry point here runs
 * AFTER the response (next/server after()), catches everything and logs without secrets, so a message can never change,
 * delay or fail the order or status change that caused it.
 *
 * A job only runs while the database connection is open. A route has always connected first; the unit tests stub the
 * connection, so with no open connection the job does nothing (and never waits on a buffered Mongoose command).
 */

export function databaseReady(): boolean {
  return mongoose.connection.readyState === 1;
}

const errorText = (err: unknown): string => notifications.errorText(err);

/** Runs the job once the response is sent. Outside a request (a script, a test) it starts at once instead. Never throws. */
export function runAfterResponse(label: string, job: () => Promise<void>): void {
  const guarded = async (): Promise<void> => {
    try {
      if (!databaseReady()) return;
      await job();
    } catch (err) {
      console.error('[seller-backend] notification job failed', { job: label, error: errorText(err) });
    }
  };
  try {
    after(guarded);
  } catch {
    void guarded();
  }
}

export const outboxModel = (): NotificationOutboxModel => NotificationOutbox as unknown as NotificationOutboxModel;

/** Already after the response: the first send starts at once. */
const startNow = (run: () => Promise<void>): void => {
  void run();
};

/** Queues one email (see @markaz/notifications enqueueNotification). Never throws. */
export function enqueueEmail(input: EnqueueInput, options: { sendNow?: boolean } = {}): Promise<EnqueueResult> {
  return notifications.enqueueNotification(outboxModel(), input, { schedule: startNow, ...(options.sendNow === undefined ? {} : { sendNow: options.sendNow }) });
}

// ---------------------------------------------------------------------------------------------------------------------
// Links in messages

function baseUrl(raw: string | undefined): URL | null {
  try {
    return raw ? new URL(raw) : null;
  } catch {
    return null;
  }
}

/** The shopper's tracking page of an order on the storefront: <slug>.<STOREFRONT_URL host>/track?order=<number>. */
export function storefrontTrackLink(slug: string, orderNumber: string): string | null {
  const root = baseUrl(process.env.STOREFRONT_URL);
  if (root === null || slug === '') return null;
  return root.protocol + '//' + slug + '.' + root.host.replace(/^www\./, '') + '/track?order=' + encodeURIComponent(orderNumber);
}

/** A page of the store's dashboard in the seller portal (APP_BASE_URL_SELLER), e.g. /orders/<id>. */
export function sellerDashboardLink(storeId: string, path: string): string | null {
  const root = baseUrl(process.env.APP_BASE_URL_SELLER);
  if (root === null) return null;
  return root.origin + root.pathname.replace(/\/+$/, '') + '/s/' + encodeURIComponent(storeId) + path;
}

const TRACKING_FALLBACK = 'the Track Order page of the store';
const DASHBOARD_FALLBACK = 'your Markazify dashboard';

// ---------------------------------------------------------------------------------------------------------------------
// Store and owner

export interface StoreNotifyInfo {
  name: string;
  slug: string;
  ownerEmail: string | null;
  emailNewOrder: boolean;
  emailLowStock: boolean;
  /** The store's own footer for the emails to its customers (EP-07.US02.T02), or null. */
  emailFooter: string | null;
}

export async function loadStoreNotifyInfo(storeId: string): Promise<StoreNotifyInfo | null> {
  const store = (await Store.findById(storeId).select('name slug owner storefront').lean()) as {
    name?: unknown;
    slug?: unknown;
    owner?: unknown;
    storefront?: unknown;
  } | null;
  if (!store) return null;
  const owner = store.owner
    ? ((await User.findById(String(store.owner)).select('email notificationPrefs').lean()) as { email?: unknown; notificationPrefs?: unknown } | null)
    : null;
  const prefs = readNotificationPrefs(owner?.notificationPrefs);
  return {
    name: typeof store.name === 'string' ? store.name : 'Your store',
    slug: typeof store.slug === 'string' ? store.slug : '',
    ownerEmail: typeof owner?.email === 'string' && owner.email !== '' ? owner.email : null,
    emailNewOrder: prefs.emailNewOrder,
    emailLowStock: prefs.emailLowStock,
    emailFooter: readMessages(store.storefront).emailFooter,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Seller alerts

export interface NewSellerAlert {
  store: string;
  /** One of SELLER_ALERT_KINDS (contracts), the same list the model and lib/seller-alerts.ts use; test/seller-alert-kinds.test.ts keeps the four places in step. */
  kind: SellerAlertKind;
  title: string;
  body: string;
  link: string | null;
  dedupeKey: string;
  order?: string | null;
  product?: string | null;
  variantId?: string | null;
}

const isDuplicateKey = (err: unknown): boolean => typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;

/** Writes one open alert. A second one with the same open key is a duplicate and is ignored: the answer is then null. */
export async function createSellerAlert(alert: NewSellerAlert): Promise<string | null> {
  try {
    const created = (await SellerAlert.create({
      store: alert.store,
      kind: alert.kind,
      title: alert.title.slice(0, 160),
      body: alert.body.slice(0, 500),
      link: alert.link,
      readAt: null,
      dedupeKey: alert.dedupeKey,
      open: true,
      resolvedAt: null,
      order: alert.order ?? null,
      product: alert.product ?? null,
      variantId: alert.variantId ?? null,
    })) as unknown as { _id: unknown };
    return String(created._id);
  } catch (err) {
    if (isDuplicateKey(err)) return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Orders

interface OrderFields {
  id: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string | null;
  paymentMethod: string;
  total: number;
  city: string;
  courier: string;
  trackingNumber: string;
  /** Sprint 5 EP-11: an order waiting for the seller's phone confirmation. */
  unconfirmed: boolean;
  items: Array<{ title: string; variantTitle: string | null; quantity: number; unitPrice: number }>;
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

function orderFields(order: unknown): OrderFields {
  const row = (order ?? {}) as Record<string, unknown>;
  const items = Array.isArray(row.items) ? (row.items as Array<Record<string, unknown>>) : [];
  return {
    id: String(row._id ?? ''),
    orderNumber: str(row.orderId),
    customerName: str(row.customerName).trim() || 'Customer',
    customerEmail: str(row.customerEmail).trim() || null,
    paymentMethod: notifications.paymentMethodLabel(row.paymentMethod),
    total: Number(row.total ?? 0),
    city: str(row.city).trim() || '-',
    courier: str(row.courier),
    trackingNumber: str(row.trackingNumber),
    unconfirmed: readConfirmationStatus(row.confirmationStatus) === 'unconfirmed',
    items: items.map((item) => ({
      title: str(item.productTitle) || 'Item',
      variantTitle: str(item.variantTitle) || null,
      quantity: Number(item.quantity ?? 1),
      unitPrice: Number(item.unitPrice ?? 0),
    })),
  };
}

/**
 * EP-07.US01.T03: a new order queues the customer's confirmation (only when an email was given), the seller's email
 * (unless switched off, US03.T03) and the seller's in-app alert. Each has its own key, so a repeat queues nothing.
 */
export async function sendOrderPlaced(storeId: string, order: unknown): Promise<void> {
  const o = orderFields(order);
  if (o.id === '' || o.orderNumber === '') return;
  const store = await loadStoreNotifyInfo(storeId);
  if (!store) return;

  const items = notifications.formatItems(o.items);
  const total = notifications.formatRupees(o.total);

  await enqueueEmail({
    template: 'order_placed_customer',
    to: o.customerEmail,
    vars: {
      storeName: store.name,
      customerName: o.customerName,
      orderNumber: o.orderNumber,
      items,
      total,
      paymentMethod: o.paymentMethod,
      trackingLink: storefrontTrackLink(store.slug, o.orderNumber) ?? TRACKING_FALLBACK,
    },
    store: storeId,
    order: o.id,
    dedupeKey: 'order_placed_customer:' + o.id + ':email',
    footer: store.emailFooter,
  });

  if (store.emailNewOrder) {
    await enqueueEmail({
      template: 'order_placed_seller',
      to: store.ownerEmail,
      vars: {
        storeName: store.name,
        orderNumber: o.orderNumber,
        customerName: o.customerName,
        items,
        total,
        paymentMethod: o.paymentMethod,
        city: o.city,
        dashboardLink: sellerDashboardLink(storeId, '/orders/' + o.id) ?? DASHBOARD_FALLBACK,
      },
      store: storeId,
      order: o.id,
      dedupeKey: 'order_placed_seller:' + o.id + ':email',
    });
  }

  // Sprint 5 EP-11 (D-108): ONE bell alert per order. A COD order waiting for the seller's phone confirmation raises the
  // unconfirmed_order kind in place of new_order, under the same key, so the order never alerts twice.
  await createSellerAlert({
    store: storeId,
    kind: o.unconfirmed ? 'unconfirmed_order' : 'new_order',
    title: o.unconfirmed ? 'Order ' + o.orderNumber + ' needs a confirmation call' : 'New order ' + o.orderNumber,
    body: o.customerName + ', ' + o.city + ' - ' + total + ' (' + o.paymentMethod + ')',
    link: '/orders/' + o.id,
    dedupeKey: 'neworder:' + o.id,
    order: o.id,
  });
}

/** Queues the new-order messages after the response. Call it only once the order is saved and announced (see callers). */
export function notifyOrderPlaced(storeId: string, order: unknown): void {
  runAfterResponse('order_placed', () => sendOrderPlaced(storeId, order));
}

/** The customer email of each status (EP-07.US01.T04). processing has none. */
export const STATUS_EMAIL_TEMPLATES: Readonly<Record<string, TemplateName>> = {
  confirmed: 'order_confirmed',
  dispatched: 'order_dispatched',
  delivered: 'order_delivered',
  cancelled: 'order_cancelled',
};

/**
 * One customer email for the status the order now has. Called only by the winner of the compare-and-set that moved the
 * order there; the key template:orderId also makes a second call a no-op.
 */
export async function sendOrderStatus(storeId: string, order: unknown, status: string): Promise<void> {
  const template = STATUS_EMAIL_TEMPLATES[status];
  if (!template) return;
  const o = orderFields(order);
  if (o.id === '' || o.orderNumber === '' || o.customerEmail === null) return;
  const store = await loadStoreNotifyInfo(storeId);
  if (!store) return;

  await enqueueEmail({
    template,
    to: o.customerEmail,
    vars: {
      storeName: store.name,
      customerName: o.customerName,
      orderNumber: o.orderNumber,
      courier: o.courier,
      trackingNumber: o.trackingNumber,
      trackingLink: storefrontTrackLink(store.slug, o.orderNumber) ?? TRACKING_FALLBACK,
    },
    store: storeId,
    order: o.id,
    dedupeKey: template + ':' + o.id,
    footer: store.emailFooter,
  });
}

export function notifyOrderStatus(storeId: string, order: unknown, status: string): void {
  if (!STATUS_EMAIL_TEMPLATES[status]) return;
  runAfterResponse('order_status', () => sendOrderStatus(storeId, order, status));
}

// ---------------------------------------------------------------------------------------------------------------------
// Store live (Sprint 4 EP-04.US06, B5)

/** The storefront of a store: <slug>.<STOREFRONT_URL host>. */
export function storefrontHomeLink(slug: string): string | null {
  const root = baseUrl(process.env.STOREFRONT_URL);
  if (root === null || slug === '') return null;
  return root.protocol + '//' + slug + '.' + root.host.replace(/^www\./, '');
}

/** One email to the owner when the store goes live. The key store_live:<id> makes a second call a no-op. */
export async function sendStoreLive(storeId: string): Promise<void> {
  const store = await loadStoreNotifyInfo(storeId);
  if (!store || store.ownerEmail === null) return;
  await enqueueEmail({
    template: 'store_live',
    to: store.ownerEmail,
    vars: {
      storeName: store.name,
      storefrontLink: storefrontHomeLink(store.slug) ?? 'your store address',
      dashboardLink: sellerDashboardLink(storeId, '') ?? DASHBOARD_FALLBACK,
    },
    store: storeId,
    dedupeKey: 'store_live:' + storeId,
  });
}

export function notifyStoreLive(storeId: string): void {
  runAfterResponse('store_live', () => sendStoreLive(storeId));
}

// ---------------------------------------------------------------------------------------------------------------------
// Payouts (Sprint 4 EP-05.US03, B9)

export const PAYOUT_METHOD_LABELS: Readonly<Record<string, string>> = { bank: 'Bank transfer', jazzcash: 'JazzCash', easypaisa: 'Easypaisa' };

export interface PayoutMessageFields {
  id: string;
  amount: number;
  method: string;
  reference: string;
  voidReason?: string | null;
}

/** One email to the store owner when a payout is made. The key payout_paid:<id> makes a second call a no-op. */
export async function sendPayoutPaid(storeId: string, payout: PayoutMessageFields): Promise<void> {
  const store = await loadStoreNotifyInfo(storeId);
  if (!store || store.ownerEmail === null) return;
  await enqueueEmail({
    template: 'payout_paid',
    to: store.ownerEmail,
    vars: {
      storeName: store.name,
      payoutAmount: notifications.formatRupees(payout.amount),
      payoutMethod: PAYOUT_METHOD_LABELS[payout.method] ?? payout.method,
      payoutReference: payout.reference,
      dashboardLink: sellerDashboardLink(storeId, '/earnings') ?? DASHBOARD_FALLBACK,
    },
    store: storeId,
    dedupeKey: 'payout_paid:' + payout.id,
  });
}

/** One email to the store owner when a payout is taken back, with the admin's reason. Key payout_voided:<id>. */
export async function sendPayoutVoided(storeId: string, payout: PayoutMessageFields): Promise<void> {
  const store = await loadStoreNotifyInfo(storeId);
  if (!store || store.ownerEmail === null) return;
  await enqueueEmail({
    template: 'payout_voided',
    to: store.ownerEmail,
    vars: {
      storeName: store.name,
      payoutAmount: notifications.formatRupees(payout.amount),
      voidReason: payout.voidReason ?? 'No reason was given.',
      dashboardLink: sellerDashboardLink(storeId, '/earnings') ?? DASHBOARD_FALLBACK,
    },
    store: storeId,
    dedupeKey: 'payout_voided:' + payout.id,
  });
}

/** Queued after the response, best effort: a failed email never changes the payout. */
export function notifyPayoutPaid(storeId: string, payout: PayoutMessageFields): void {
  runAfterResponse('payout_paid', () => sendPayoutPaid(storeId, payout));
}

export function notifyPayoutVoided(storeId: string, payout: PayoutMessageFields): void {
  runAfterResponse('payout_voided', () => sendPayoutVoided(storeId, payout));
}

// ---------------------------------------------------------------------------------------------------------------------
// Returns (Sprint 5 EP-13.US01.T04, US02.T02)

interface ReturnFields {
  id: string;
  returnNumber: string;
  orderObjectId: string;
}

function returnFields(doc: unknown): ReturnFields {
  const row = (doc ?? {}) as Record<string, unknown>;
  return { id: String(row._id ?? ''), returnNumber: str(row.returnNumber), orderObjectId: String(row.order ?? '') };
}

/**
 * A shopper asked for a return: ONE email to the seller (unless new-order emails are switched off) and ONE bell alert of the return_requested
 * kind, each under its own key (return:<id>:requested), so a repeat queues nothing. Never throws; run it after the response.
 */
export async function sendReturnRequested(storeId: string, returnDoc: unknown, order: unknown): Promise<void> {
  const r = returnFields(returnDoc);
  const o = orderFields(order);
  if (r.id === '' || r.returnNumber === '') return;
  const store = await loadStoreNotifyInfo(storeId);
  if (!store) return;
  if (store.emailNewOrder) {
    await enqueueEmail({
      template: 'return_requested_seller',
      to: store.ownerEmail,
      vars: {
        storeName: store.name,
        orderNumber: o.orderNumber,
        returnNumber: r.returnNumber,
        customerName: o.customerName,
        dashboardLink: sellerDashboardLink(storeId, '/returns') ?? DASHBOARD_FALLBACK,
      },
      store: storeId,
      order: r.orderObjectId,
      dedupeKey: 'return:' + r.id + ':requested',
    });
  }
  await createSellerAlert({
    store: storeId,
    kind: 'return_requested',
    title: 'Return request ' + r.returnNumber,
    body: o.customerName + ' asked to return items from order ' + o.orderNumber,
    link: '/returns',
    dedupeKey: 'return:' + r.id + ':requested',
    order: r.orderObjectId === '' ? null : r.orderObjectId,
  });
}

export function notifyReturnRequested(storeId: string, returnDoc: unknown, order: unknown): void {
  runAfterResponse('return_requested', () => sendReturnRequested(storeId, returnDoc, order));
}

/** The seller's decision, told to the shopper by email when the order has one (most shoppers have none: the seller gets a wa.me link). */
export async function sendReturnDecision(storeId: string, returnDoc: unknown, order: unknown, decision: 'approved' | 'rejected', reason: string | null): Promise<void> {
  const r = returnFields(returnDoc);
  const o = orderFields(order);
  if (r.id === '' || r.returnNumber === '' || o.customerEmail === null) return;
  const store = await loadStoreNotifyInfo(storeId);
  if (!store) return;
  await enqueueEmail({
    template: decision === 'approved' ? 'return_approved_customer' : 'return_rejected_customer',
    to: o.customerEmail,
    vars: {
      storeName: store.name,
      customerName: o.customerName,
      orderNumber: o.orderNumber,
      returnNumber: r.returnNumber,
      ...(decision === 'rejected' ? { returnReason: reason && reason.trim() !== '' ? reason : 'Not stated' } : {}),
    },
    store: storeId,
    order: r.orderObjectId,
    dedupeKey: 'return:' + r.id + ':' + decision,
    footer: store.emailFooter,
  });
}

export function notifyReturnDecision(storeId: string, returnDoc: unknown, order: unknown, decision: 'approved' | 'rejected', reason: string | null): void {
  runAfterResponse('return_decision', () => sendReturnDecision(storeId, returnDoc, order, decision, reason));
}
