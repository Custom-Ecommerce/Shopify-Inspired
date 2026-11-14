import mongoose from 'mongoose';
import { after } from 'next/server';
import * as notificationsNs from '@markaz/notifications';
import type { EnqueueInput, EnqueueResult, NotificationOutboxModel, TemplateName } from '@markaz/notifications';
import { unwrapCjs } from '@/lib/cjs';
import { readNotificationPrefs } from '@/lib/contracts';
import { NotificationOutbox, SellerAlert, Store, User } from '@/lib/services';

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
export function enqueueEmail(input: EnqueueInput): Promise<EnqueueResult> {
  return notifications.enqueueNotification(outboxModel(), input, { schedule: startNow });
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
}

export async function loadStoreNotifyInfo(storeId: string): Promise<StoreNotifyInfo | null> {
  const store = (await Store.findById(storeId).select('name slug owner').lean()) as { name?: unknown; slug?: unknown; owner?: unknown } | null;
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
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Seller alerts

export interface NewSellerAlert {
  store: string;
  kind: 'new_order' | 'low_stock' | 'out_of_stock';
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

  await createSellerAlert({
    store: storeId,
    kind: 'new_order',
    title: 'New order ' + o.orderNumber,
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
  });
}

export function notifyOrderStatus(storeId: string, order: unknown, status: string): void {
  if (!STATUS_EMAIL_TEMPLATES[status]) return;
  runAfterResponse('order_status', () => sendOrderStatus(storeId, order, status));
}
