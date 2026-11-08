import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Product } from '@/lib/services';
import { ProductVariantError, prepareProductVariants } from '../src/lib/product-variants';

const STORE_A = '65a000000000000000000011';
const STORE_B = '65a000000000000000000012';
const PRODUCT_1 = '65a0000000000000000000b1';
const PRODUCT_2 = '65a0000000000000000000b2';

interface ProductRow {
  _id: string;
  store: string;
  variants: Array<{ sku: string | null }>;
}

interface SkuFilter {
  store: string;
  'variants.sku': { $in: string[] };
  _id?: { $ne: string };
}

interface StubQuery {
  select: () => StubQuery;
  lean: () => Promise<unknown>;
}

const ProductStub = Product as unknown as { find: (filter: SkuFilter) => StubQuery };

let catalog: ProductRow[];
let lookups: number;
let restore: () => void;

beforeEach(() => {
  catalog = [
    { _id: PRODUCT_1, store: STORE_A, variants: [{ sku: 'KURTA-S' }, { sku: null }] },
    { _id: PRODUCT_2, store: STORE_B, variants: [{ sku: 'SHOE-42' }] },
  ];
  lookups = 0;
  const saved = ProductStub.find;
  ProductStub.find = (filter) => {
    lookups += 1;
    const rows = catalog.filter(
      (row) =>
        row.store === filter.store &&
        row._id !== filter._id?.$ne &&
        row.variants.some((variant) => variant.sku !== null && filter['variants.sku'].$in.includes(variant.sku)),
    );
    const q: StubQuery = { select: () => q, lean: async () => rows };
    return q;
  };
  restore = () => {
    ProductStub.find = saved;
  };
});

afterEach(() => restore());

const single = (sku: string | null) => ({ variants: [{ sku, price: 1000 }] });

const sized = (skus: Array<string | null>) => ({
  options: [{ name: 'Size', values: ['S', 'M', 'L'] }],
  variants: skus.map((sku, index) => ({ sku, price: 1000 + index, optionValues: [['S', 'M', 'L'][index]] })),
});

async function refusal(run: Promise<unknown>): Promise<ProductVariantError> {
  try {
    await run;
  } catch (error) {
    assert.ok(error instanceof ProductVariantError);
    return error;
  }
  throw new Error('expected a refusal');
}

test('a SKU another product of the store holds is refused with 409 SKU_TAKEN and named', async () => {
  const error = await refusal(prepareProductVariants(STORE_A, single('KURTA-S')));
  assert.equal(error.status, 409);
  assert.equal(error.code, 'SKU_TAKEN');
  assert.deepEqual(error.details, { skus: ['KURTA-S'] });
});

test('the same SKU in another store is allowed', async () => {
  const prepared = await prepareProductVariants(STORE_A, single('SHOE-42'));
  assert.equal(prepared.variants[0].sku, 'SHOE-42');
});

test('a SKU repeated inside one product is refused with 422, before any database read', async () => {
  const error = await refusal(prepareProductVariants(STORE_A, sized(['DUP', 'DUP', 'OTHER'])));
  assert.equal(error.status, 422);
  assert.equal(error.code, 'INVALID_VARIANTS');
  assert.match(error.message, /same SKU/);
  assert.equal(lookups, 0);
});

test('null SKUs never clash: not in one product, not across products, and no lookup is made for them', async () => {
  const prepared = await prepareProductVariants(STORE_A, sized([null, null, null]));
  assert.deepEqual(prepared.variants.map((variant) => variant.sku), [null, null, null]);
  assert.equal(lookups, 0);
});

test('an empty SKU means no SKU, and a SKU is trimmed before it is compared', async () => {
  assert.equal((await prepareProductVariants(STORE_A, single('   '))).variants[0].sku, null);
  const error = await refusal(prepareProductVariants(STORE_A, single('  KURTA-S  ')));
  assert.equal(error.code, 'SKU_TAKEN');
});

test('a product updating itself does not clash with its own SKU', async () => {
  const prepared = await prepareProductVariants(STORE_A, single('KURTA-S'), PRODUCT_1);
  assert.equal(prepared.variants[0].sku, 'KURTA-S');
});

test('the derived fields are returned: titles, positions, and minPrice', async () => {
  const prepared = await prepareProductVariants(STORE_A, {
    options: [{ name: 'Size', values: ['S', 'M'] }, { name: 'Colour', values: ['Red'] }],
    variants: [
      { price: 1500, optionValues: ['S', 'Red'] },
      { price: 1200, optionValues: ['M', 'Red'] },
    ],
  });
  assert.deepEqual(prepared.variants.map((variant) => variant.title), ['S / Red', 'M / Red']);
  assert.deepEqual(prepared.variants.map((variant) => variant.position), [0, 1]);
  assert.equal(prepared.minPrice, 1200);
});

test('every limit and consistency rule is a 422 INVALID_VARIANTS with its own message', async () => {
  const size = { name: 'Size', values: ['S', 'M'] };
  const cases: Array<[unknown, RegExp]> = [
    [{ options: [size], variants: [{ price: 1, optionValues: ['S'] }, { price: 2, optionValues: ['S'] }] }, /same options/],
    [{ options: [size], variants: [{ price: 1, optionValues: ['XL'] }] }, /not a value of Size/],
    [{ options: [size], variants: [{ price: 1, optionValues: ['S', 'M'] }] }, /one value for each option/],
    [{ options: [size], variants: [{ price: 1, optionValues: [] }] }, /one value for each option/],
    [{ variants: [{ price: 1 }, { price: 2 }] }, /exactly one variant/],
  ];
  for (const [input, message] of cases) {
    const error = await refusal(prepareProductVariants(STORE_A, input));
    assert.equal(error.status, 422);
    assert.equal(error.code, 'INVALID_VARIANTS');
    assert.match(error.message, message);
  }

  const four = ['A', 'B', 'C', 'D'].map((name) => ({ name, values: ['x'] }));
  assert.equal((await refusal(prepareProductVariants(STORE_A, { options: four, variants: [{ price: 1, optionValues: ['x', 'x', 'x', 'x'] }] }))).code, 'INVALID_VARIANTS');

  const values = Array.from({ length: 11 }, (_, index) => 'v' + index);
  const options = [{ name: 'A', values }, { name: 'B', values }];
  const variants = values.flatMap((a) => values.map((b) => ({ price: 1, optionValues: [a, b] })));
  assert.equal(variants.length, 121);
  assert.equal((await refusal(prepareProductVariants(STORE_A, { options, variants }))).code, 'INVALID_VARIANTS');
});

test('a product with no options gets the Default variant', async () => {
  const prepared = await prepareProductVariants(STORE_A, { variants: [{ price: 999 }] });
  assert.equal(prepared.variants[0].title, 'Default');
  assert.deepEqual(prepared.variants[0].optionValues, []);
  assert.equal(prepared.minPrice, 999);
});

test('a decimal price is rounded before the rules run, and a bad compare-at is a 422, never dropped', async () => {
  const prepared = await prepareProductVariants(STORE_A, { variants: [{ price: 1499.5, compareAtPrice: 1999.4 }] });
  assert.equal(prepared.variants[0].price, 1500);
  assert.equal(prepared.variants[0].compareAtPrice, 1999);

  const error = await refusal(prepareProductVariants(STORE_A, { variants: [{ price: 1000, compareAtPrice: 1000 }] }));
  assert.equal(error.status, 422);
  assert.match(error.message, /compare-at price must be higher/);

  // 999.6 rounds up to the price itself, so it is refused on the rounded value.
  const rounded = await refusal(prepareProductVariants(STORE_A, { variants: [{ price: 1000, compareAtPrice: 1000.4 }] }));
  assert.equal(rounded.status, 422);
});

test('an existing variant keeps its id, so it stays the variant in carts and orders', async () => {
  const id = '65a0000000000000000000e1';
  const prepared = await prepareProductVariants(STORE_A, { variants: [{ id, price: 100 }] });
  assert.equal(prepared.variants[0]._id, id);
});
