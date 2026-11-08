import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { duplicateProduct } from '@/lib/product-duplicate';
import { ProductVariantError, isSkuDuplicateError, withSkuGuard } from '@/lib/product-variants';
import { handleProductError, productPatchSet } from '@/lib/products';
import { Product } from '@/lib/services';

// GAP 5: the unique (store, skus) index decides a race between two writers. These tests stand in for the database by
// throwing the error MongoServerError throws for each index.

const STORE = '65a000000000000000000011';
const SOURCE = '65a0000000000000000000b1';
const V1 = '65a0000000000000000000d1';

const skuClash = (sku: string) =>
  Object.assign(new Error('E11000 duplicate key error collection: products index: store_1_skus_1 dup key'), {
    code: 11000,
    keyPattern: { store: 1, skus: 1 },
    keyValue: { store: STORE, skus: sku },
  });

const slugClash = () =>
  Object.assign(new Error('E11000 duplicate key error collection: products index: store_1_slug_1 dup key'), {
    code: 11000,
    keyPattern: { store: 1, slug: 1 },
    keyValue: { store: STORE, slug: 'kurta' },
  });

test('a duplicate key on the skus index is a SKU clash; one on the slug index is not', () => {
  assert.equal(isSkuDuplicateError(skuClash('K-1')), true);
  assert.equal(isSkuDuplicateError(slugClash()), false);
  assert.equal(isSkuDuplicateError(new Error('E11000 ... index: store_1_skus_1')), false, 'no code 11000, not a duplicate key');
  assert.equal(isSkuDuplicateError(Object.assign(new Error('E11000 index: store_1_skus_1 dup key'), { code: 11000 })), true, 'message fallback');
});

test('withSkuGuard turns a lost SKU race into 409 SKU_TAKEN and lets everything else through', async () => {
  await assert.rejects(
    withSkuGuard(async () => {
      throw skuClash('K-1');
    }),
    (err: unknown) => err instanceof ProductVariantError && err.status === 409 && err.code === 'SKU_TAKEN' && err.message.includes('K-1'),
  );
  const slug = slugClash();
  await assert.rejects(
    withSkuGuard(async () => {
      throw slug;
    }),
    (err: unknown) => err === slug,
  );
  assert.equal(await withSkuGuard(async () => 'written'), 'written');
});

test('the product error handler answers a raw SKU race 409 SKU_TAKEN and a slug race 409 PRODUCT_SLUG_TAKEN', async () => {
  const sku = handleProductError(skuClash('K-1'));
  assert.equal(sku.status, 409);
  const skuBody = (await sku.json()) as { errors: Array<{ code: string; skus: string[] }> };
  assert.equal(skuBody.errors[0].code, 'SKU_TAKEN');
  assert.deepEqual(skuBody.errors[0].skus, ['K-1']);

  const slug = handleProductError(slugClash());
  assert.equal(slug.status, 409);
  assert.equal(((await slug.json()) as { errors: Array<{ code: string }> }).errors[0].code, 'PRODUCT_SLUG_TAKEN');
});

test('a PATCH that rewrites variants rewrites skus with them, strings only', () => {
  const variant = (sku: string | null, position: number) => ({
    title: 'V' + position,
    sku,
    barcode: null,
    price: 100,
    compareAtPrice: null,
    trackQuantity: true,
    stockQuantity: 1,
    lowStockThreshold: null,
    optionValues: ['V' + position],
    imageId: null,
    position,
  });
  const set = productPatchSet({}, { options: [{ name: 'Size', values: ['V0', 'V1', 'V2'] }], variants: [variant('A', 0), variant(null, 1), variant('B', 2)], minPrice: 100 });
  assert.deepEqual(set.skus, { $literal: ['A', 'B'] });
  assert.equal('skus' in productPatchSet({ title: 'Only the title' }, null), false, 'a PATCH without variants leaves skus alone');
});

// duplicateProduct: a writer that takes the chosen -COPY SKU between the read and the create makes the create fail on the
// index. The copy reads again and takes the next candidate; after the last attempt the 409 stands.

type Doc = Record<string, unknown>;
interface Chain {
  select: () => Chain;
  lean: () => Promise<unknown>;
}
const stub = Product as unknown as {
  find: (filter: Doc) => Chain;
  findOne: (filter: Doc) => Chain;
  create: (doc: Doc) => Promise<{ _id: string }>;
};
const saved = { find: stub.find, findOne: stub.findOne, create: stub.create };
const chain = (value: unknown): Chain => {
  const q: Chain = { select: () => q, lean: async () => value };
  return q;
};

let held: string[];
let creates: Doc[];
let clashesLeft: number;

beforeEach(() => {
  held = ['KURTA'];
  creates = [];
  clashesLeft = 0;
  stub.findOne = () =>
    chain({
      _id: SOURCE,
      title: 'Kurta',
      slug: 'kurta',
      isDemo: false,
      deletedAt: null,
      moderation: null,
      options: [],
      variants: [{ _id: V1, title: 'Default', sku: 'KURTA', price: 1000, trackQuantity: true, stockQuantity: 3, optionValues: [], position: 0 }],
    });
  stub.find = (filter) => {
    const wanted = (filter['variants.sku'] as { $in: string[] } | undefined)?.$in;
    if (wanted) return chain(held.filter((sku) => wanted.includes(sku)).map((sku) => ({ variants: [{ sku }] })));
    return chain([]);
  };
  stub.create = async (doc) => {
    const sku = (doc.variants as Array<{ sku: string | null }>)[0].sku as string;
    if (clashesLeft > 0) {
      clashesLeft -= 1;
      held.push(sku); // the other writer now holds it
      throw skuClash(sku);
    }
    creates.push(doc);
    return { _id: '65a0000000000000000000f1' };
  };
});

afterEach(() => Object.assign(stub, saved));

test('duplicate retries with the next -COPY SKU when another writer took the first one', async () => {
  clashesLeft = 1;
  await duplicateProduct(STORE, SOURCE);
  assert.equal(creates.length, 1);
  assert.equal((creates[0].variants as Array<{ sku: string }>)[0].sku, 'KURTA-COPY-2');
});

test('duplicate answers 409 SKU_TAKEN when every attempt loses the race', async () => {
  clashesLeft = 10;
  await assert.rejects(duplicateProduct(STORE, SOURCE), (err: unknown) => err instanceof ProductVariantError && err.status === 409 && err.code === 'SKU_TAKEN');
  assert.equal(creates.length, 0);
});
