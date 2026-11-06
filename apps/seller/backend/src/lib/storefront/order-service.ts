import { randomUUID } from 'node:crypto';
import { isDuplicateKeyError } from '@/lib/http';
import { Order, Product } from '@/lib/services';
import { StorefrontHttpError } from '@/lib/storefront/errors';
import { generateOrderId } from '@/lib/storefront/order-id';
import type { OrderRow } from '@/lib/storefront/order-dto';
import type { ParsedOrderRequest } from '@/lib/storefront/order-request';
import { computeTotals } from '@/lib/storefront/pricing';
import { releaseAll, reserveStock, type Reservation } from '@/lib/storefront/stock';
import type { StoreCommerce } from '@/lib/storefront/store-guard';

export interface PlaceOrderResult {
  order: OrderRow;
  /** True when an earlier request with the same idempotency key already created this order. */
  replayed: boolean;
}

interface CatalogRow {
  _id: unknown;
  title: string;
  price: number;
  deliveryCharge?: number | null;
  stockQuantity?: number | null;
  reservedQuantity?: number | null;
  stockStatus: 'in_stock' | 'low_stock' | 'out_of_stock';
}

const ORDER_ID_ATTEMPTS = 5;

const outOfStock = (productId: string): StorefrontHttpError =>
  new StorefrontHttpError(409, 'OUT_OF_STOCK', 'A product in the order is out of stock.', { productId });

const unknownProduct = (productId: string): StorefrontHttpError =>
  new StorefrontHttpError(422, 'UNKNOWN_PRODUCT', 'A product in the order is not available.', { productId });

function plain(doc: unknown): OrderRow {
  const maybe = doc as { toObject?: () => unknown };
  return (typeof maybe.toObject === 'function' ? maybe.toObject() : doc) as OrderRow;
}

/** True when a duplicate-key error is about the named field. MongoServerError carries keyPattern; the message is the fallback. */
function duplicateOn(err: unknown, field: string): boolean {
  if (!isDuplicateKeyError(err)) return false;
  const e = err as { keyPattern?: Record<string, unknown>; message?: unknown };
  if (e.keyPattern && typeof e.keyPattern === 'object') return field in e.keyPattern;
  return typeof e.message === 'string' && e.message.includes(field);
}

async function findByKey(storeId: string, idempotencyKey: string): Promise<OrderRow | null> {
  const row = await (Order as any).findOne({ store: storeId, idempotencyKey }).lean();
  return (row as OrderRow | null) ?? null;
}

/** A retry with the same key and the same content gets the first order. The same key with different content is a client bug. */
function replay(existing: OrderRow, fingerprint: string): PlaceOrderResult {
  if (existing.requestFingerprint && existing.requestFingerprint !== fingerprint) {
    throw new StorefrontHttpError(
      409,
      'IDEMPOTENCY_CONFLICT',
      'This Idempotency-Key was already used for a different order. Start a new checkout.',
    );
  }
  return { order: existing, replayed: true };
}

/**
 * Reads every product in the request from the catalog (this store, published only) and prices the order from
 * those rows. Checks stock in request order, so the first problem line is the one reported.
 */
async function priceOrder(storeId: string, commerce: StoreCommerce, request: ParsedOrderRequest) {
  const rows = (await (Product as any)
    .find({ _id: { $in: request.lines.map((l) => l.productId) }, store: storeId, isPublished: true })
    .select('title price deliveryCharge stockQuantity reservedQuantity stockStatus')
    .lean()) as CatalogRow[];
  const byId = new Map(rows.map((row) => [String(row._id).toLowerCase(), row]));

  const priced = request.lines.map((line) => {
    const row = byId.get(line.productId);
    if (!row || typeof row.price !== 'number' || !Number.isFinite(row.price) || row.price < 0) {
      throw unknownProduct(line.productId);
    }
    const available = (row.stockQuantity ?? 0) - (row.reservedQuantity ?? 0);
    if (row.stockStatus === 'out_of_stock' || available < line.qty) throw outOfStock(line.productId);
    return {
      productId: line.productId,
      title: row.title,
      unitPrice: row.price,
      qty: line.qty,
      deliveryCharge: typeof row.deliveryCharge === 'number' ? row.deliveryCharge : null,
    };
  });

  return { lines: priced, totals: computeTotals(priced, commerce) };
}

/** Saves the order, retrying with a fresh order id on the (astronomically rare) id collision. */
async function insertOrder(data: Record<string, unknown>): Promise<OrderRow> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return plain(await (Order as any).create({ ...data, orderId: generateOrderId() }));
    } catch (err) {
      if (duplicateOn(err, 'orderId') && attempt < ORDER_ID_ATTEMPTS) continue;
      throw err;
    }
  }
}

/**
 * Places an order. The sequence is the safety argument:
 *
 *   1. An existing order for this (store, idempotencyKey) is returned as is. No pricing, no stock change.
 *   2. The order is priced from catalog rows read now; client prices do not exist on the wire.
 *   3. Stock is taken line by line with a conditional write. A line that loses a race releases the lines
 *      already taken.
 *   4. The order is saved. If that fails the stock is released. If it fails because a concurrent request
 *      with the same key saved first (the unique index decides), this request releases its stock and
 *      returns the winner's order, so a double submit costs one unit of stock, once.
 */
export async function placeOrder(storeId: string, commerce: StoreCommerce, request: ParsedOrderRequest): Promise<PlaceOrderResult> {
  const existing = await findByKey(storeId, request.idempotencyKey);
  if (existing) return replay(existing, request.fingerprint);

  const { lines, totals } = await priceOrder(storeId, commerce, request);

  const reserved: Reservation[] = [];
  try {
    for (const line of lines) {
      await reserveStock(storeId, line.productId, line.qty);
      reserved.push({ productId: line.productId, qty: line.qty });
    }
  } catch (err) {
    await releaseAll(storeId, reserved);
    throw err;
  }

  try {
    const order = await insertOrder({
      store: storeId,
      orderGroupId: randomUUID(),
      idempotencyKey: request.idempotencyKey,
      requestFingerprint: request.fingerprint,
      status: 'pending',
      paymentMethod: request.paymentMethod,
      customerName: request.customer.customerName,
      phone: request.customer.phone,
      address: request.customer.address,
      city: request.customer.city,
      items: lines.map((l) => ({ productId: l.productId, productTitle: l.title, unitPrice: l.unitPrice, quantity: l.qty })),
      subtotal: totals.subtotal,
      deliveryCharges: totals.deliveryCharges,
      total: totals.total,
    });
    return { order, replayed: false };
  } catch (err) {
    await releaseAll(storeId, reserved);
    if (duplicateOn(err, 'idempotencyKey')) {
      const winner = await findByKey(storeId, request.idempotencyKey);
      if (winner) return replay(winner, request.fingerprint);
    }
    throw err;
  }
}
