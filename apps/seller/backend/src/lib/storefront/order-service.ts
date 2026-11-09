import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { isDuplicateKeyError } from '@/lib/http';
import { toWholeRupees } from '@/lib/contracts';
import { revalidateStoreProduct } from '@/lib/revalidate';
import { Order, Product } from '@/lib/services';
import { StorefrontHttpError, productUnavailable } from '@/lib/storefront/errors';
import { isLiveProduct, type LiveFlags } from '@/lib/storefront/live-product';
import { generateOrderId } from '@/lib/storefront/order-id';
import type { OrderRow } from '@/lib/storefront/order-dto';
import type { ParsedOrderRequest } from '@/lib/storefront/order-request';
import { computeTotals } from '@/lib/storefront/pricing';
import { releaseAll, reserveStock, type Reservation } from '@/lib/storefront/stock';
import type { StoreCommerce } from '@/lib/storefront/store-guard';
import { canSupply, resolveVariant, type CheckoutVariant } from '@/lib/storefront/variant';

export interface PlaceOrderResult {
  order: OrderRow;
  /** True when an earlier request with the same idempotency key already created this order. */
  replayed: boolean;
}

interface CatalogRow extends LiveFlags {
  _id: unknown;
  title: string;
  deliveryCharge?: number | null;
  variants: CheckoutVariant[];
}

/** One priced order line: what the server read now, never what the client said. */
interface PricedLine {
  productId: string;
  variantId: string;
  title: string;
  variantTitle: string;
  sku: string | null;
  unitPrice: number;
  qty: number;
  deliveryCharge: number | null;
}

const ORDER_ID_ATTEMPTS = 5;

const outOfStock = (productId: string, variantId: string): StorefrontHttpError =>
  new StorefrontHttpError(409, 'OUT_OF_STOCK', 'A product in the order is out of stock.', { productId, variantId });

const variantRequired = (productId: string): StorefrontHttpError =>
  new StorefrontHttpError(422, 'VARIANT_REQUIRED', 'Choose a variant of this product.', { productId });

const unknownVariant = (productId: string): StorefrontHttpError =>
  new StorefrontHttpError(422, 'UNKNOWN_VARIANT', 'A variant in the order is not available.', { productId });

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
  const row = await Order.findOne({ store: storeId, idempotencyKey }).lean();
  return (row as unknown as OrderRow | null) ?? null;
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
 * Reads every product in the request from this store's catalog and prices the order from the variant each line
 * resolves to. A product that is not Live is refused with 422 PRODUCT_UNAVAILABLE (D-037). Checks stock in request order, so the first problem line is the one reported.
 * A line naming the Default variant and one leaving it out are the same variant, so their quantities are added first.
 */
async function priceOrder(storeId: string, commerce: StoreCommerce, request: ParsedOrderRequest) {
  const rows = (await Product.find({ _id: { $in: request.lines.map((l) => l.productId) }, store: storeId })
    .select('title deliveryCharge variants isPublished isDemo deletedAt moderation')
    .lean()) as unknown as CatalogRow[];
  const byId = new Map(rows.map((row) => [String(row._id).toLowerCase(), row]));

  const byVariant = new Map<string, PricedLine & { variant: CheckoutVariant }>();
  for (const line of request.lines) {
    const row = byId.get(line.productId);
    if (!row) throw unknownProduct(line.productId);
    if (!isLiveProduct(row)) throw productUnavailable(line.productId);

    const match = resolveVariant(row.variants, line.variantId);
    if (match.kind === 'variant_required') throw variantRequired(line.productId);
    if (match.kind === 'unknown_variant') throw unknownVariant(line.productId);

    const { variant } = match;
    // The same rule as the quote, so the price a shopper saw is the price they are charged.
    const unitPrice = toWholeRupees(variant.price);
    if (unitPrice === null) throw unknownProduct(line.productId);

    const variantId = String(variant._id).toLowerCase();
    const key = line.productId + '|' + variantId;
    const existing = byVariant.get(key);
    if (existing) {
      existing.qty += line.qty;
      continue;
    }
    byVariant.set(key, {
      productId: line.productId,
      variantId,
      title: row.title,
      variantTitle: variant.title,
      sku: variant.sku ?? null,
      unitPrice,
      qty: line.qty,
      deliveryCharge: typeof row.deliveryCharge === 'number' ? row.deliveryCharge : null,
      variant,
    });
  }

  const priced = [...byVariant.values()].map(({ variant, ...line }): PricedLine => {
    if (!canSupply(variant, line.qty)) throw outOfStock(line.productId, line.variantId);
    return line;
  });

  return { lines: priced, totals: computeTotals(priced, commerce) };
}

/** Saves the order, retrying with a fresh order id on the (astronomically rare) id collision. */
async function insertOrder(data: Record<string, unknown>): Promise<OrderRow> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return plain(await Order.create({ ...data, orderId: generateOrderId() }));
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

  // The order's _id is chosen before stock is taken, so every stock movement of this placement can carry it (D-066).
  // If the order is never saved (a failure, or a parallel request with the same key won) the movements name an id that
  // does not exist; the release movements carry the same id, so the pair still reads as taken and given back.
  const orderObjectId = new Types.ObjectId().toHexString();

  const reserved: Reservation[] = [];
  const soldOut = new Set<string>();
  try {
    for (const line of lines) {
      const taken = await reserveStock(storeId, line.productId, line.variantId, line.qty, orderObjectId);
      reserved.push({ productId: line.productId, variantId: line.variantId, qty: line.qty, deducted: taken.deducted });
      if (taken.soldOut) soldOut.add(line.productId);
    }
  } catch (err) {
    await releaseAll(storeId, reserved, orderObjectId);
    throw err;
  }

  try {
    const order = await insertOrder({
      _id: orderObjectId,
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
      customerEmail: request.customer.email,
      customerNote: request.customer.note,
      items: lines.map((l, i) => ({
        productId: l.productId,
        variantId: l.variantId,
        productTitle: l.title,
        variantTitle: l.variantTitle,
        sku: l.sku,
        unitPrice: l.unitPrice,
        quantity: l.qty,
        // reserved[i] is this line: lines are reserved in order and any failure above has already thrown.
        stockDeducted: reserved[i]!.deducted,
      })),
      subtotal: totals.subtotal,
      deliveryCharges: totals.deliveryCharges,
      total: totals.total,
    });
    // Only once the order is saved: until then a failure would give the units back.
    for (const productId of soldOut) revalidateStoreProduct(storeId, productId);
    return { order, replayed: false };
  } catch (err) {
    await releaseAll(storeId, reserved, orderObjectId);
    if (duplicateOn(err, 'idempotencyKey')) {
      const winner = await findByKey(storeId, request.idempotencyKey);
      if (winner) return replay(winner, request.fingerprint);
    }
    throw err;
  }
}
