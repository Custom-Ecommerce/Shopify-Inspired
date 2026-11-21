import mongoose from 'mongoose';
import { AbandonedCart, EmailUnsubscribe, Product, Review, Store } from '@/lib/services';
import { installReturnsWorld, matches, type ReturnsWorld, type Row } from './returns-world';

/**
 * Sprint 5 SB-4 test fixture (EP-21 reviews, EP-28 abandoned carts): everything of ./returns-world (stores, owners, orders, returns, the ledger, the
 * outbox, the bell alerts, the audit log) plus, in memory, the reviews, the abandoned carts, the products a review is about, and the unsubscribed
 * emails. No database.
 *
 * Every write matches and changes ONE row in one synchronous step after a single yield, like MongoDB does for one document. The unique indexes are
 * emulated: reviews { order, product } (where the order is set) and carts { store, phone } while the cart is open. It understands the operators
 * ./returns-world understands (equality, $ne, $in, $exists, $gt, $gte, $lt, $lte) and dotted $set paths ('reply.text'), and throws on any other
 * operator, so a changed query shape is noticed.
 */

export const PRODUCT_P1 = '65a0000000000000000c0001';
export const PRODUCT_P2 = '65a0000000000000000c0002';
export const STOREFRONT_P1 = 'shirt';

export interface ReviewsWorld extends ReturnsWorld {
  reviews: Row[];
  carts: Row[];
  products: Row[];
  unsubscribed: string[];
  /** Every { $set } the code wrote to a product (the average and the count). */
  productWrites: Row[];
  /** A delivered COD order of store A for review tests (the returns world's order()), with the products in the catalog. */
  deliveredOrder: (fields?: Row) => Row;
  /** A review row as the routes read it. */
  review: (fields?: Row) => Row;
  /** An abandoned cart row as the routes read it. */
  cart: (fields?: Row) => Row;
  restoreReviews: () => void;
}

const same = (a: unknown, b: unknown): boolean => String(a) === String(b);
const clone = (row: Row): Row => JSON.parse(JSON.stringify(row, (_key, value) => value), (_key, value) => (typeof value === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(value) ? new Date(value) : value));

/** Like returns-world's chain: select, sort ({ field: 1|-1 }), skip, limit and lean. */
function chain(read: () => unknown) {
  let sortSpec: Row | null = null;
  let skipped = 0;
  let cap: number | null = null;
  const q: any = {
    select: () => q,
    sort: (spec: Row) => {
      sortSpec = spec;
      return q;
    },
    skip: (n: number) => {
      skipped = n;
      return q;
    },
    limit: (n: number) => {
      cap = n;
      return q;
    },
    lean: async () => {
      const value = read();
      if (!Array.isArray(value)) return value;
      let rows = [...value];
      if (sortSpec) {
        const entries = Object.entries(sortSpec) as Array<[string, number]>;
        rows.sort((a, b) => {
          for (const [field, dir] of entries) {
            const left = field === '_id' ? String(a[field]) : (a[field] as any)?.valueOf?.() ?? a[field];
            const right = field === '_id' ? String(b[field]) : (b[field] as any)?.valueOf?.() ?? b[field];
            if (left < right) return -1 * dir;
            if (left > right) return 1 * dir;
          }
          return 0;
        });
      }
      rows = rows.slice(skipped);
      return cap === null ? rows : rows.slice(0, cap);
    },
  };
  return q;
}

/** A Mongo $set with dotted paths ('reply.text') applied to a stored row. */
function applySet(row: Row, set: Row): void {
  for (const [path, value] of Object.entries(set)) {
    const parts = path.split('.');
    let target = row;
    for (const part of parts.slice(0, -1)) {
      if (target[part] === null || target[part] === undefined || typeof target[part] !== 'object') target[part] = {};
      target = target[part];
    }
    target[parts[parts.length - 1]!] = value;
  }
  row.updatedAt = new Date();
}

const dup = () => Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });

export function installReviewsWorld(): ReviewsWorld {
  const base = installReturnsWorld();
  const ReviewModel = Review as any;
  const CartModel = AbandonedCart as any;
  const ProductModel = Product as any;
  const UnsubModel = EmailUnsubscribe as any;
  const StoreModel = Store as any;
  const saved = {
    review: Object.fromEntries(['create', 'find', 'findOne', 'findOneAndUpdate', 'countDocuments', 'aggregate'].map((m) => [m, ReviewModel[m]])),
    cart: Object.fromEntries(['create', 'find', 'findOne', 'findOneAndUpdate', 'findOneAndDelete', 'countDocuments', 'updateMany'].map((m) => [m, CartModel[m]])),
    product: Object.fromEntries(['find', 'findOne', 'findById', 'updateOne'].map((m) => [m, ProductModel[m]])),
    unsub: UnsubModel.find,
    storeFind: StoreModel.find,
  };

  let seq = 0;
  const world = base as ReviewsWorld;
  world.reviews = [];
  world.carts = [];
  world.products = [
    { _id: PRODUCT_P1, store: '65a000000000000000000011', slug: STOREFRONT_P1, title: 'Shirt', isPublished: true, isDemo: false, deletedAt: null, moderation: null, avgRating: 0, reviewCount: 0 },
    { _id: PRODUCT_P2, store: '65a000000000000000000011', slug: 'cap', title: 'Cap', isPublished: true, isDemo: false, deletedAt: null, moderation: null, avgRating: 0, reviewCount: 0 },
  ];
  world.unsubscribed = [];
  world.productWrites = [];

  world.deliveredOrder = (fields = {}) => world.order(fields);
  world.review = (fields = {}) => {
    seq += 1;
    const row: Row = {
      _id: '65a0000000000000000f' + String(seq).padStart(4, '0'),
      store: '65a000000000000000000011',
      product: PRODUCT_P1,
      order: '65a0000000000000000a0001',
      customer: null,
      rating: 5,
      title: null,
      body: 'Soft fabric, true to size.',
      images: [],
      status: 'approved',
      displayName: 'Ayesha K.',
      verified: true,
      reply: null,
      hiddenReason: null,
      hiddenAt: null,
      hiddenBy: null,
      createdAt: new Date(Date.UTC(2026, 10, 15, 10, seq)),
      updatedAt: new Date(Date.UTC(2026, 10, 15, 10, seq)),
      ...fields,
    };
    world.reviews.push(row);
    return row;
  };
  world.cart = (fields = {}) => {
    seq += 1;
    const lastSeenAt = (fields.lastSeenAt as Date | undefined) ?? new Date();
    const row: Row = {
      _id: '65a0000000000000000b' + String(seq).padStart(4, '0'),
      store: '65a000000000000000000011',
      phone: '+923001234567',
      email: null,
      items: [{ productId: PRODUCT_P1, variantId: '65a0000000000000000d0001', productTitle: 'Shirt', variantTitle: 'M', quantity: 2, unitPrice: 1000 }],
      total: 2000,
      status: 'open',
      consentAt: lastSeenAt,
      contactedAt: null,
      recoveredOrder: null,
      recoveredAt: null,
      lastSeenAt,
      emailQueuedAt: null,
      expiresAt: new Date(lastSeenAt.getTime() + 7 * 86_400_000),
      createdAt: lastSeenAt,
      updatedAt: lastSeenAt,
      ...fields,
    };
    world.carts.push(row);
    return row;
  };

  // ------------------------------------------------------------------------------------------------------------------ reviews
  ReviewModel.create = async (doc: Row) => {
    await Promise.resolve();
    if (doc.order !== null && doc.order !== undefined && world.reviews.some((r) => same(r.order, doc.order) && same(r.product, doc.product))) throw dup();
    seq += 1;
    const now = new Date(Date.UTC(2026, 10, 16, 10, seq));
    const row: Row = {
      _id: '65a0000000000000000f' + String(seq).padStart(4, '0'),
      images: [],
      reply: null,
      hiddenReason: null,
      hiddenAt: null,
      hiddenBy: null,
      createdAt: now,
      updatedAt: now,
      ...doc,
      store: String(doc.store),
      product: String(doc.product),
      order: doc.order === null || doc.order === undefined ? null : String(doc.order),
    };
    world.reviews.push(row);
    return clone(row);
  };
  ReviewModel.find = (filter: Row) => chain(() => world.reviews.filter((r) => matches(r, filter)).map(clone));
  ReviewModel.findOne = (filter: Row) => chain(() => (world.reviews.find((r) => matches(r, filter)) ? clone(world.reviews.find((r) => matches(r, filter))!) : null));
  ReviewModel.countDocuments = async (filter: Row) => world.reviews.filter((r) => matches(r, filter)).length;
  ReviewModel.findOneAndUpdate = (filter: Row, update: Row) => ({
    lean: async () => {
      await Promise.resolve();
      const row = world.reviews.find((r) => matches(r, filter));
      if (!row) return null;
      applySet(row, update.$set ?? {});
      return clone(row);
    },
  });
  // ratingSummary(): { $match, $group { count, sum } } over the approved reviews of one product.
  ReviewModel.aggregate = async (pipeline: Row[]) => {
    const match = pipeline[0]?.$match ?? {};
    const rows = world.reviews.filter((r) => matches(r, match));
    return rows.length === 0 ? [] : [{ _id: null, count: rows.length, sum: rows.reduce((total, r) => total + Number(r.rating), 0) }];
  };

  // ----------------------------------------------------------------------------------------------------------------- products
  ProductModel.find = (filter: Row) => chain(() => world.products.filter((p) => matches(p, filter)).map(clone));
  ProductModel.findOne = (filter: Row) => chain(() => (world.products.find((p) => matches(p, filter)) ? clone(world.products.find((p) => matches(p, filter))!) : null));
  ProductModel.findById = (id: unknown) => chain(() => (world.products.find((p) => same(p._id, id)) ? clone(world.products.find((p) => same(p._id, id))!) : null));
  ProductModel.updateOne = async (filter: Row, update: Row) => {
    await Promise.resolve();
    const row = world.products.find((p) => matches(p, filter));
    if (!row) return { matchedCount: 0 };
    Object.assign(row, update.$set ?? {});
    world.productWrites.push({ _id: row._id, ...(update.$set ?? {}) });
    return { matchedCount: 1 };
  };

  // --------------------------------------------------------------------------------------------------------- abandoned carts
  CartModel.create = async (doc: Row) => {
    await Promise.resolve();
    if (doc.status === 'open' && world.carts.some((c) => c.status === 'open' && same(c.store, doc.store) && c.phone === doc.phone)) throw dup();
    seq += 1;
    const now = new Date();
    const row: Row = { _id: '65a0000000000000000b' + String(seq).padStart(4, '0'), contactedAt: null, recoveredOrder: null, recoveredAt: null, emailQueuedAt: null, createdAt: now, updatedAt: now, ...doc, store: String(doc.store) };
    world.carts.push(row);
    return clone(row);
  };
  CartModel.find = (filter: Row) => chain(() => world.carts.filter((c) => matches(c, filter)).map(clone));
  CartModel.findOne = (filter: Row) => chain(() => (world.carts.find((c) => matches(c, filter)) ? clone(world.carts.find((c) => matches(c, filter))!) : null));
  CartModel.countDocuments = async (filter: Row) => world.carts.filter((c) => matches(c, filter)).length;
  CartModel.findOneAndUpdate = (filter: Row, update: Row) => ({
    lean: async () => {
      await Promise.resolve();
      const row = world.carts.find((c) => matches(c, filter));
      if (!row) return null;
      applySet(row, update.$set ?? {});
      return clone(row);
    },
  });
  CartModel.findOneAndDelete = (filter: Row) => ({
    lean: async () => {
      await Promise.resolve();
      const index = world.carts.findIndex((c) => matches(c, filter));
      if (index === -1) return null;
      return clone(world.carts.splice(index, 1)[0]!);
    },
  });
  CartModel.updateMany = async (filter: Row, update: Row) => {
    await Promise.resolve();
    const rows = world.carts.filter((c) => matches(c, filter));
    for (const row of rows) applySet(row, update.$set ?? {});
    return { modifiedCount: rows.length };
  };

  // ----------------------------------------------------------------------------------------------- unsubscribes and stores
  UnsubModel.find = (filter: Row) => chain(() => world.unsubscribed.filter((email) => (filter.email?.$in as string[] | undefined)?.includes(email) ?? true).map((email) => ({ email })));
  // The abandoned cart email step: the active stores that switched the email on (paymentSettings.abandonedCartEmail, a dotted path).
  StoreModel.find = (filter: Row) =>
    chain(() =>
      world.stores
        .filter((s) => (filter.status === undefined || s.status === filter.status) && (filter['paymentSettings.abandonedCartEmail'] === undefined || s.paymentSettings?.abandonedCartEmail === filter['paymentSettings.abandonedCartEmail']))
        .map(clone),
    );

  world.restoreReviews = () => {
    for (const [name, fn] of Object.entries(saved.review)) ReviewModel[name] = fn;
    for (const [name, fn] of Object.entries(saved.cart)) CartModel[name] = fn;
    for (const [name, fn] of Object.entries(saved.product)) ProductModel[name] = fn;
    UnsubModel.find = saved.unsub;
    StoreModel.find = saved.storeFind;
  };
  const restoreBase = base.restore;
  world.restore = () => {
    world.restoreReviews();
    restoreBase();
  };
  // Keep mongoose referenced (the base world already opened the stubbed connection).
  void mongoose;
  return world;
}
