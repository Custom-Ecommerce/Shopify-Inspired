import { storefrontOrderCreatedSchema, storefrontOrderSchema, storefrontOrderTrackingSchema } from '@/lib/contracts';

/** An order as .lean() (or toObject) returns it. */
export interface OrderRow {
  orderId: string;
  status: string;
  paymentMethod?: string | null;
  customerName?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  items?: Array<{
    productId: string;
    variantId: string;
    productTitle: string;
    variantTitle: string;
    sku?: string | null;
    unitPrice: number;
    quantity: number;
  }> | null;
  subtotal?: number | null;
  deliveryCharges?: number | null;
  total?: number | null;
  discountCode?: string | null;
  discountAmount?: number | null;
  idempotencyKey?: string | null;
  requestFingerprint?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

function iso(value: Date | string | null | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value !== '') return value;
  return new Date(0).toISOString();
}

function created(row: OrderRow) {
  return {
    orderId: row.orderId,
    status: row.status,
    // Orders written before checkout existed have no method; they were all cash on delivery.
    paymentMethod: row.paymentMethod ?? 'cod',
    subtotal: row.subtotal ?? 0,
    deliveryCharges: row.deliveryCharges ?? 0,
    discount: row.discountAmount ?? 0,
    total: row.total ?? 0,
    createdAt: iso(row.createdAt),
  };
}

/** The POST /orders body: what the shopper needs to show a confirmation. */
export function toOrderCreatedDto(row: OrderRow) {
  return storefrontOrderCreatedSchema.parse(created(row));
}

/**
 * The lookup body. Only fields the shopper supplied or can see on their own order: no store id, no
 * idempotency key, no fingerprint, no internal ids.
 */
export function toOrderDto(row: OrderRow) {
  return storefrontOrderSchema.parse({
    ...created(row),
    customerName: row.customerName ?? '',
    phone: row.phone ?? '',
    city: row.city ?? null,
    address: row.address ?? '',
    discountCode: row.discountCode ?? null,
    items: (row.items ?? []).map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      title: item.productTitle,
      variantTitle: item.variantTitle,
      unitPrice: item.unitPrice,
      qty: item.quantity,
      lineTotal: Math.round((item.unitPrice * item.quantity + Number.EPSILON) * 100) / 100,
    })),
    updatedAt: iso(row.updatedAt ?? row.createdAt),
  });
}

// EP-02 OB-4 (D-069): customer tracking. Only the parcel's journey: no customer, address, items, totals, notes or ids.

export interface OrderTrackingRow {
  orderId: string;
  status: string;
  createdAt?: Date | string | null;
  courier?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  statusHistory?: Array<{ to?: unknown; at?: Date | string | null }> | null;
}

const TRACKING_STATUSES = ['pending', 'confirmed', 'processing', 'dispatched', 'delivered', 'cancelled', 'returned'] as const;
type TrackingStatus = (typeof TRACKING_STATUSES)[number];

const isTrackingStatus = (value: unknown): value is TrackingStatus =>
  typeof value === 'string' && (TRACKING_STATUSES as readonly string[]).includes(value);

/**
 * The tracking body. dates holds the first time the order reached each status, read from statusHistory; pending is the
 * order's creation time (every order starts pending, including old ones with no history). A cancelled order shows its
 * status only: no dates, no courier. Courier and tracking appear only while dispatched or delivered.
 */
export function toOrderTrackingDto(row: OrderTrackingRow) {
  const status: TrackingStatus = isTrackingStatus(row.status) ? row.status : 'pending';
  const createdAt = iso(row.createdAt);
  const dates: Record<TrackingStatus, string | null> = {
    pending: null,
    confirmed: null,
    processing: null,
    dispatched: null,
    delivered: null,
    cancelled: null,
    returned: null,
  };
  if (status !== 'cancelled') {
    dates.pending = createdAt;
    for (const entry of row.statusHistory ?? []) {
      if (!isTrackingStatus(entry.to) || entry.to === 'pending' || dates[entry.to] !== null) continue;
      if (entry.at === null || entry.at === undefined) continue;
      dates[entry.to] = iso(entry.at);
    }
  }
  const shipped = status === 'dispatched' || status === 'delivered';
  return storefrontOrderTrackingSchema.parse({
    orderId: row.orderId,
    status,
    createdAt,
    dates,
    courier: shipped ? row.courier ?? null : null,
    trackingNumber: shipped ? row.trackingNumber ?? null : null,
    trackingUrl: shipped ? row.trackingUrl ?? null : null,
  });
}
