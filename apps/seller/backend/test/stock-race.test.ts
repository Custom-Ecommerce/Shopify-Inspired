import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Product, StockMovement } from '@/lib/services';
import { adjustInventory } from '../src/lib/inventory';
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
  isDemo?: boolean;
  deletedAt?: Date | null;
  variants: VariantRow[];
}

interface ElemMatch {
  _id: string;
  trackQuantity?: boolean;
  stockQuantity?: { $gte: number } | number;
}

interface ProductFilter {
  _id: string;
  store: string;
  isPublished?: boolean;
  isDemo?: { $ne: boolean };
  deletedAt?: null;
  variants: { $elemMatch: ElemMatch };
}

interface StubQuery {
  select: () => StubQuery;
  lean: () => Promise<unknown>;
}

const ProductStub = Product as unknown as {
  findOneAndUpdate: (filter: ProductFilter, update: { $inc: Record<string, number> }) => StubQuery;
  exists: (filter: ProductFilter) => Promise<unknown>;
  findOne: (filter: Omit<ProductFilter, 'variants'>) => StubQuery;
};
const MovementStub = StockMovement as unknown as { create: (doc: Record<string, unknown>) => Promise<unknown> };

let product: ProductRow;
let lowestSeen: number;
let writes: Array<{ filter: ProductFilter; update: { $inc: Record<string, number> } }>;
let movements: Array<Record<string, unknown>>;
let restore: () => void;
/** Runs right after a stock read and before the write that follows it: the moment an order can land. */
let afterRead: () => Promise<void>;

const turn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function ownerMatches(filter: Omit<ProductFilter, 'variants'>): boolean {
  if (filter._id !== product._id || filter.store !== product.store) return false;
  if (filter.isPublished !== undefined && filter.isPublished !== product.isPublished) return false;
  if (filter.deletedAt === null && product.deletedAt) return false;
  return !(filter.isDemo !== undefined && product.isDemo === true);
}

function matches(filter: ProductFilter): VariantRow | null {
  if (!ownerMatches(filter)) return null;
  const wanted = filter.variants.$elemMatch;
  const variant = product.variants.find((candidate) => candidate._id === wanted._id);
  if (!variant) return null;
  if (wanted.trackQuantity !== undefined && variant.trackQuantity !== wanted.trackQuantity) return null;
  if (typeof wanted.stockQuantity === 'number') return variant.stockQuantity === wanted.stockQuantity ? variant : null;
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
  afterRead = async () => {};

  const saved = { update: ProductStub.findOneAndUpdate, exists: ProductStub.exists, findOne: ProductStub.findOne, create: MovementStub.create };

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
        return { variants: product.variants.map((row) => ({ ...row })) };
      },
    };
    return q;
  };
  ProductStub.exists = async (filter) => {
    await turn();
    return matches(filter) ? { _id: filter._id } : null;
  };
  ProductStub.findOne = (filter) => {
    const q: StubQuery = {
      select: () => q,
      lean: async () => {
        await turn();
        const read = ownerMatches(filter) ? { variants: product.variants.map((row) => ({ ...row })) } : null;
        await afterRead();
        return read;
      },
    };
    return q;
  };
  MovementStub.create = async (doc) => {
    movements.push(doc);
    return doc;
  };

  restore = () => {
    ProductStub.findOneAndUpdate = saved.update;
    ProductStub.exists = saved.exists;
    ProductStub.findOne = saved.findOne;
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

test('a demo product and a trashed product cannot be reserved, and the refusal says why', async () => {
  for (const flags of [{ isDemo: true }, { deletedAt: new Date() }]) {
    product = { ...product, isDemo: false, deletedAt: null, ...flags };
    await assert.rejects(reserveStock(STORE, PRODUCT, SMALL, 1), (err: unknown) => {
      assert.ok(err instanceof StorefrontHttpError);
      assert.equal(err.status, 422);
      assert.equal(err.code, 'PRODUCT_UNAVAILABLE');
      return true;
    });
    await assert.rejects(reserveStock(STORE, PRODUCT, UNTRACKED, 1), StorefrontHttpError);
  }
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

/* ------------------------------------ the Inventory adjust endpoint ------------------------------------ */

const ACTOR = '65a000000000000000000001';
const line = (variantId: string, change: { delta?: number; setTo?: number }, productId = PRODUCT) => ({
  productId,
  variantId,
  reason: 'Stock count',
  ...change,
});

test('adjust never takes stock below 0, and a refused line writes no history', async () => {
  const { results, failed } = await adjustInventory(STORE, ACTOR, [line(SMALL, { delta: -6 })]);
  assert.equal(failed, 1);
  const [result] = results;
  assert.ok(!result.ok);
  assert.equal(result.code, 'STOCK_WOULD_GO_NEGATIVE');
  assert.equal(result.status, 422);
  assert.equal(stockOf(SMALL), 5);
  assert.equal(movements.length, 0);

  assert.equal((await adjustInventory(STORE, ACTOR, [line(SMALL, { delta: -5 })])).succeeded, 1);
  assert.equal(stockOf(SMALL), 0);
});

test('a delta is one conditional $inc on that variant of this store, and leaves one history row with the actor', async () => {
  const { results } = await adjustInventory(STORE, ACTOR, [line(LARGE, { delta: -30 })]);
  assert.deepEqual(writes[0].update, { $inc: { 'variants.$.stockQuantity': -30 } });
  assert.deepEqual(writes[0].filter.variants.$elemMatch, { _id: LARGE, trackQuantity: true, stockQuantity: { $gte: 30 } });
  assert.equal(writes[0].filter.store, STORE);
  assert.equal(writes[0].filter.deletedAt, null);

  const [result] = results;
  assert.ok(result.ok);
  assert.deepEqual([result.previousQuantity, result.delta, result.quantity, result.availability], [100, -30, 70, 'in_stock']);

  assert.equal(movements.length, 1);
  const { changedAt, ...movement } = movements[0];
  assert.ok(changedAt instanceof Date);
  assert.deepEqual(movement, {
    store: STORE,
    product: PRODUCT,
    variantId: LARGE,
    previousQuantity: 100,
    quantity: 70,
    delta: -30,
    reason: 'Stock count',
    actor: ACTOR,
  });
});

test('partial failure: each line answers for itself and a bad line undoes nothing', async () => {
  const outcome = await adjustInventory(STORE, ACTOR, [
    line(SMALL, { delta: 1 }),
    line(UNTRACKED, { delta: 1 }),
    line('65a0000000000000000000ee', { setTo: 1 }),
    line(SMALL, { delta: 1 }, '65a0000000000000000000ff'),
    line(LARGE, { setTo: 90 }),
  ]);
  assert.deepEqual(
    outcome.results.map((result) => (result.ok ? 'ok' : result.status + ' ' + result.code)),
    ['ok', '422 VARIANT_NOT_TRACKED', '404 VARIANT_NOT_FOUND', '404 PRODUCT_NOT_FOUND', 'ok'],
  );
  assert.deepEqual([outcome.succeeded, outcome.failed], [2, 3]);
  assert.equal(stockOf(SMALL), 6);
  assert.equal(stockOf(LARGE), 90);
  assert.equal(movements.length, 2);
});

test('another store, and a trashed product, are simply not found', async () => {
  const foreign = await adjustInventory('65a000000000000000000012', ACTOR, [line(SMALL, { delta: 1 })]);
  assert.ok(!foreign.results[0].ok && foreign.results[0].code === 'PRODUCT_NOT_FOUND');
  product.deletedAt = new Date();
  for (const change of [{ delta: 1 }, { setTo: 9 }]) {
    const trashed = await adjustInventory(STORE, ACTOR, [line(SMALL, change)]);
    assert.ok(!trashed.results[0].ok && trashed.results[0].code === 'PRODUCT_NOT_FOUND');
  }
  assert.equal(stockOf(SMALL), 5);
});

test('setTo is a guarded delta, never a blind write of the count', async () => {
  await adjustInventory(STORE, ACTOR, [line(SMALL, { setTo: 8 })]);
  assert.deepEqual(writes[0].update, { $inc: { 'variants.$.stockQuantity': 3 } });
  assert.equal(writes[0].filter.variants.$elemMatch.stockQuantity, 5);
  assert.equal(stockOf(SMALL), 8);
});

test('setTo at the current count changes nothing and records nothing', async () => {
  const { results } = await adjustInventory(STORE, ACTOR, [line(SMALL, { setTo: 5 })]);
  assert.ok(results[0].ok && results[0].delta === 0);
  assert.equal(writes.length, 0);
  assert.equal(movements.length, 0);
});

test('an order that lands between the read and the write of a setTo is seen: the delta is worked out again', async () => {
  let landed = false;
  afterRead = async () => {
    if (landed) return;
    landed = true;
    await reserveStock(STORE, PRODUCT, SMALL, 2);
  };
  const { results } = await adjustInventory(STORE, ACTOR, [line(SMALL, { setTo: 8 })]);
  assert.ok(results[0].ok);
  assert.deepEqual([results[0].previousQuantity, results[0].delta, results[0].quantity], [3, 5, 8]);
  assert.equal(stockOf(SMALL), 8);
  assert.deepEqual(movements.map((row) => row.delta), [-2, 5]);
});

test('a setTo that keeps losing gives up with STOCK_CHANGED instead of overwriting', async () => {
  afterRead = async () => {
    await reserveStock(STORE, PRODUCT, LARGE, 1);
  };
  const { results } = await adjustInventory(STORE, ACTOR, [line(LARGE, { setTo: 500 })]);
  assert.ok(!results[0].ok && results[0].code === 'STOCK_CHANGED' && results[0].status === 409);
  assert.equal(stockOf(LARGE), 95);
});

test('adjustments racing orders never lose an update: the history always adds up to the stock', async () => {
  const orders = Array.from({ length: 40 }, () => reserveStock(STORE, PRODUCT, LARGE, 2));
  const adjustments = Array.from({ length: 10 }, (_, index) => adjustInventory(STORE, ACTOR, [line(LARGE, { delta: index % 2 === 0 ? 7 : -3 })]));
  const counted = adjustInventory(STORE, ACTOR, [line(LARGE, { setTo: 60 })]);
  await Promise.allSettled([...orders, ...adjustments, counted]);

  const total = movements.reduce((sum, row) => sum + Number(row.delta), 0);
  assert.equal(stockOf(LARGE), 100 + total);
  assert.ok(lowestSeen >= 0);
});
