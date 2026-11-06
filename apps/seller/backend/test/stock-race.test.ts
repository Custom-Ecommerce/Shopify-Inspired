import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Product, StockMovement } from '@/lib/services';
import { StorefrontHttpError } from '../src/lib/storefront/errors';
import { releaseStock, reserveStock } from '../src/lib/storefront/stock';

const STORE = '65a000000000000000000011';
const PRODUCT = '65a0000000000000000000b1';
const SMALL = '65a0000000000000000000e1';
const LARGE = '65a0000000000000000000e2';
const UNTRACKED = '65a0000000000000000000e3';

interface VariantRow {
  _id: string;
  trackQuantity: boolean;
  stockQuantity: number;
}

interface ProductRow {
  _id: string;
  store: string;
  isPublished: boolean;
  variants: VariantRow[];
}

interface ElemMatch {
  _id: string;
  trackQuantity?: boolean;
  stockQuantity?: { $gte: number };
}

interface ProductFilter {
  _id: string;
  store: string;
  isPublished?: boolean;
  variants: { $elemMatch: ElemMatch };
}

interface StubQuery {
  select: () => StubQuery;
  lean: () => Promise<unknown>;
}

const ProductStub = Product as unknown as {
  findOneAndUpdate: (filter: ProductFilter, update: { $inc: Record<string, number> }) => StubQuery;
  exists: (filter: ProductFilter) => Promise<unknown>;
};
const MovementStub = StockMovement as unknown as { create: (doc: Record<string, unknown>) => Promise<unknown> };

let product: ProductRow;
let lowestSeen: number;
let writes: Array<{ filter: ProductFilter; update: { $inc: Record<string, number> } }>;
let movements: Array<Record<string, unknown>>;
let restore: () => void;

const turn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function matches(filter: ProductFilter): VariantRow | null {
  if (filter._id !== product._id || filter.store !== product.store) return null;
  if (filter.isPublished !== undefined && filter.isPublished !== product.isPublished) return null;
  const wanted = filter.variants.$elemMatch;
  const variant = product.variants.find((candidate) => candidate._id === wanted._id);
  if (!variant) return null;
  if (wanted.trackQuantity !== undefined && variant.trackQuantity !== wanted.trackQuantity) return null;
  if (wanted.stockQuantity && variant.stockQuantity < wanted.stockQuantity.$gte) return null;
  return variant;
}

beforeEach(() => {
  product = {
    _id: PRODUCT,
    store: STORE,
    isPublished: true,
    variants: [
      { _id: SMALL, trackQuantity: true, stockQuantity: 5 },
      { _id: LARGE, trackQuantity: true, stockQuantity: 100 },
      { _id: UNTRACKED, trackQuantity: false, stockQuantity: 0 },
    ],
  };
  lowestSeen = Number.POSITIVE_INFINITY;
  writes = [];
  movements = [];

  const saved = { update: ProductStub.findOneAndUpdate, exists: ProductStub.exists, create: MovementStub.create };

  /*
   * MongoDB's guarantee, and no more: the match and the update of one document happen as one step. Every call first
   * yields to the event loop, so concurrent callers really interleave, but nothing yields between the check and the $inc.
   */
  ProductStub.findOneAndUpdate = (filter, update) => {
    const q: StubQuery = {
      select: () => q,
      lean: async () => {
        await turn();
        writes.push({ filter, update });
        const variant = matches(filter);
        if (!variant) return null;
        variant.stockQuantity += update.$inc['variants.$.stockQuantity'];
        lowestSeen = Math.min(lowestSeen, variant.stockQuantity);
        return { variants: product.variants.map(({ _id, stockQuantity }) => ({ _id, stockQuantity })) };
      },
    };
    return q;
  };
  ProductStub.exists = async (filter) => {
    await turn();
    return matches(filter) ? { _id: filter._id } : null;
  };
  MovementStub.create = async (doc) => {
    movements.push(doc);
    return doc;
  };

  restore = () => {
    ProductStub.findOneAndUpdate = saved.update;
    ProductStub.exists = saved.exists;
    MovementStub.create = saved.create;
  };
});

afterEach(() => restore());

const stockOf = (variantId: string): number =>
  product.variants.find((variant) => variant._id === variantId)?.stockQuantity ?? Number.NaN;

async function race(count: number, variantId: string, qty: number) {
  const results = await Promise.allSettled(
    Array.from({ length: count }, () => reserveStock(STORE, PRODUCT, variantId, qty)),
  );
  return {
    won: results.filter((result) => result.status === 'fulfilled').length,
    lost: results.filter((result) => result.status === 'rejected'),
  };
}

test('fifty shoppers racing for the last five units: exactly five win, and stock stops at zero', async () => {
  const { won, lost } = await race(50, SMALL, 1);
  assert.equal(won, 5);
  assert.equal(lost.length, 45);
  assert.equal(stockOf(SMALL), 0);
  assert.ok(lowestSeen >= 0, 'stock never went negative, even for a moment');
  assert.equal(movements.length, 5);
});

test('a race for more than one unit never oversells: 2 units each from 5 leaves 1', async () => {
  const { won } = await race(20, SMALL, 2);
  assert.equal(won, 2);
  assert.equal(stockOf(SMALL), 1);
  assert.ok(lowestSeen >= 0);
});

test('every loser gets 409 OUT_OF_STOCK naming the product and the variant', async () => {
  const { lost } = await race(10, SMALL, 5);
  assert.equal(lost.length, 9);
  for (const result of lost) {
    assert.equal(result.status, 'rejected');
    const error: unknown = result.reason;
    assert.ok(error instanceof StorefrontHttpError);
    assert.equal(error.status, 409);
    assert.equal(error.code, 'OUT_OF_STOCK');
    assert.deepEqual(error.extra, { productId: PRODUCT, variantId: SMALL });
  }
});

test('a race on one variant leaves the other variants of the product alone', async () => {
  await race(50, SMALL, 1);
  assert.equal(stockOf(LARGE), 100);
});

test('the guard is one conditional write: no read comes first, and it targets one variant', async () => {
  await reserveStock(STORE, PRODUCT, SMALL, 2);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].filter.variants.$elemMatch, { _id: SMALL, trackQuantity: true, stockQuantity: { $gte: 2 } });
  assert.deepEqual(writes[0].update, { $inc: { 'variants.$.stockQuantity': -2 } });
  assert.equal(writes[0].filter.isPublished, true);
  assert.equal(writes[0].filter.store, STORE);
});

test('a variant that does not track quantity always reserves and is never decremented', async () => {
  const { won } = await race(30, UNTRACKED, 3);
  assert.equal(won, 30);
  assert.equal(stockOf(UNTRACKED), 0);
  assert.equal(movements.length, 0);
});

test('a variant of an unpublished product, or of another store, cannot be reserved', async () => {
  product.isPublished = false;
  await assert.rejects(reserveStock(STORE, PRODUCT, SMALL, 1), StorefrontHttpError);
  product.isPublished = true;
  await assert.rejects(reserveStock('65a000000000000000000012', PRODUCT, SMALL, 1), StorefrontHttpError);
  assert.equal(stockOf(SMALL), 5);
});

test('release gives units back to that variant only, and racing release with reserve loses nothing', async () => {
  await reserveStock(STORE, PRODUCT, SMALL, 5);
  await Promise.allSettled([
    releaseStock(STORE, PRODUCT, SMALL, 2),
    reserveStock(STORE, PRODUCT, SMALL, 1),
    releaseStock(STORE, PRODUCT, SMALL, 3),
  ]);
  assert.equal(stockOf(LARGE), 100);
  assert.ok(stockOf(SMALL) === 4 || stockOf(SMALL) === 5, 'the reserve either won a unit or found none');
  assert.ok(lowestSeen >= 0);
});

test('a failed movement record does not fail the reservation', async () => {
  MovementStub.create = async () => {
    throw new Error('history is down');
  };
  await reserveStock(STORE, PRODUCT, SMALL, 1);
  assert.equal(stockOf(SMALL), 4);
});
