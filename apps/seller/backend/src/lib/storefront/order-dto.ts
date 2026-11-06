import { storefrontOrderCreatedSchema, storefrontOrderSchema } from '@/lib/contracts';

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
