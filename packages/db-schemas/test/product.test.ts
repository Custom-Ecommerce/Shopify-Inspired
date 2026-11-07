import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { Product, StockMovement } from '../src';

// These tests validate documents in memory. No database connection is needed.

const oid = () => new mongoose.Types.ObjectId();

function product(overrides: Record<string, unknown> = {}) {
  return new Product({
    store: oid(),
    title: 'Blue shirt',
    slug: 'Blue-Shirt',
    categories: [oid()],
    variants: [{ title: 'Default', price: 1500 }],
    ...overrides,
  });
}

const sized = (variants: Array<Record<string, unknown>>) => ({
  options: [{ name: 'Size', values: ['S', 'M'] }],
  variants,
});

test('product accepts a minimal valid document and applies defaults', () => {
  const doc = product();
  assert.equal(doc.validateSync(), undefined);
  assert.equal(doc.isPublished, false);
  assert.equal(doc.isDemo, false);
  assert.equal(doc.avgRating, 0);
  assert.equal(doc.reviewCount, 0);
  assert.equal(doc.deliveryCharge, null);
  const [variant] = doc.variants;
  assert.ok(variant._id, 'a variant has its own id');
  assert.equal(variant.stockQuantity, 0);
  assert.equal(variant.trackQuantity, true);
  assert.equal(variant.compareAtPrice, null);
  assert.equal(variant.sku, null);
});

test('the flat price and stock fields are gone', () => {
  for (const field of ['price', 'originalPrice', 'stockQuantity', 'stockStatus', 'lowStockThreshold', 'reservedQuantity', 'stockHistory']) {
    assert.equal(Product.schema.path(field), undefined, field);
  }
});

test('product slug is trimmed and lowercased', () => {
  assert.equal(product({ slug: '  Blue-Shirt ' }).slug, 'blue-shirt');
});

test('product requires store, title and slug', () => {
  for (const missing of ['store', 'title', 'slug']) {
    const doc = product({ [missing]: undefined });
    assert.notEqual(doc.validateSync(), undefined, missing + ' should be required');
  }
});

test('product needs at least one category and at least one variant', () => {
  assert.notEqual(product({ categories: [] }).validateSync(), undefined);
  assert.notEqual(product({ variants: [] }).validateSync(), undefined);
});

test('a product with no options has exactly one variant', () => {
  const two = product({ variants: [{ title: 'A', price: 1 }, { title: 'B', price: 2 }] });
  assert.notEqual(two.validateSync(), undefined);
});

test('variants must match the options, with no repeated combination', () => {
  const ok = sized([{ title: 'S', price: 1, optionValues: ['S'] }, { title: 'M', price: 2, optionValues: ['M'] }]);
  assert.equal(product(ok).validateSync(), undefined);
  assert.notEqual(product(sized([{ title: 'XL', price: 1, optionValues: ['XL'] }])).validateSync(), undefined);
  assert.notEqual(product(sized([{ title: 'S', price: 1, optionValues: [] }])).validateSync(), undefined);
  const repeated = sized([{ title: 'S', price: 1, optionValues: ['S'] }, { title: 'S', price: 2, optionValues: ['S'] }]);
  assert.notEqual(product(repeated).validateSync(), undefined);
});

test('at most 3 options, each named once, and at most 100 variants', () => {
  const option = (name: string) => ({ name, values: ['A'] });
  assert.notEqual(
    product({
      options: [option('a'), option('b'), option('c'), option('d')],
      variants: [{ title: 'A', price: 1, optionValues: ['A', 'A', 'A', 'A'] }],
    }).validateSync(),
    undefined,
  );
  assert.notEqual(
    product({ options: [option('Size'), option('SIZE')], variants: [{ title: 'A', price: 1, optionValues: ['A', 'A'] }] }).validateSync(),
    undefined,
  );
  const values = Array.from({ length: 101 }, (_, index) => 'v' + index);
  const tooMany = values.map((value) => ({ title: value, price: 1, optionValues: [value] }));
  assert.notEqual(product({ options: [{ name: 'Size', values: values.slice(0, 50) }], variants: tooMany }).validateSync(), undefined);
});

test('prices are whole rupees, and compare-at must beat the price', () => {
  const variant = (fields: Record<string, unknown>) => product({ variants: [{ title: 'Default', price: 1000, ...fields }] });
  assert.notEqual(variant({ price: -1 }).validateSync(), undefined);
  assert.notEqual(variant({ price: 10.5 }).validateSync(), undefined);
  assert.notEqual(variant({ compareAtPrice: 1000 }).validateSync(), undefined);
  assert.notEqual(variant({ compareAtPrice: 999 }).validateSync(), undefined);
  assert.notEqual(variant({ compareAtPrice: 1500.5 }).validateSync(), undefined);
  assert.equal(variant({ compareAtPrice: 1001 }).validateSync(), undefined);
  assert.notEqual(product({ deliveryCharge: 10.5 }).validateSync(), undefined);
  assert.equal(product({ deliveryCharge: 0 }).validateSync(), undefined);
});

test('variant stock quantity must be a whole, non-negative number', () => {
  const stocked = (stockQuantity: number) => product({ variants: [{ title: 'Default', price: 1, stockQuantity }] });
  assert.notEqual(stocked(1.5).validateSync(), undefined);
  assert.notEqual(stocked(-1).validateSync(), undefined);
  assert.equal(stocked(12).validateSync(), undefined);
});

test('minPrice is the cheapest variant, kept on every save', async () => {
  const doc = product(sized([{ title: 'S', price: 1500, optionValues: ['S'] }, { title: 'M', price: 1200, optionValues: ['M'] }]));
  await doc.validate();
  assert.equal(doc.minPrice, 1200);
});

test('product rating is bounded to 0..5', () => {
  assert.notEqual(product({ avgRating: 5.5 }).validateSync(), undefined);
});

test('product references Category and Media', () => {
  const ref = (path: string) => (Product.schema.path(path) as unknown as { caster: { options: { ref: string } } }).caster.options.ref;
  assert.equal(ref('categories'), 'Category');
  assert.equal(ref('media'), 'Media');
});

test('product slug is unique per store, and catalog indexes lead with store', () => {
  const indexes = Product.schema.indexes();
  const unique = indexes.find(([fields]) => 'slug' in fields && 'store' in fields);
  assert.ok(unique, 'store+slug index exists');
  assert.equal(unique[1].unique, true);
  for (const [fields] of indexes) assert.equal(Object.keys(fields)[0], 'store');
});

test('price sorting is indexed on minPrice, and the SKU helper index does not claim uniqueness', () => {
  const indexes = Product.schema.indexes();
  assert.ok(indexes.some(([fields]) => 'minPrice' in fields));
  const sku = indexes.find(([fields]) => 'variants.sku' in fields);
  assert.ok(sku);
  assert.notEqual(sku[1].unique, true);
});

test('SKUs are unique per store through the skus index, and products without SKUs are left out of it (GAP 5)', () => {
  const index = Product.schema.indexes().find(([fields]) => 'skus' in fields);
  assert.ok(index, 'store+skus index exists');
  assert.deepEqual(index[0], { store: 1, skus: 1 });
  assert.equal(index[1].unique, true);
  assert.deepEqual(index[1].partialFilterExpression, { skus: { $type: 'string' } });
});

test('skus is derived on validate: string SKUs only, each once, no null or blank', async () => {
  const doc = product({
    options: [{ name: 'Size', values: ['S', 'M', 'L', 'XL'] }],
    variants: [
      { title: 'S', price: 100, sku: 'K-S', optionValues: ['S'] },
      { title: 'M', price: 100, sku: null, optionValues: ['M'] },
      { title: 'L', price: 100, optionValues: ['L'] },
      { title: 'XL', price: 100, sku: 'K-XL', optionValues: ['XL'] },
    ],
  });
  await doc.validate();
  assert.deepEqual([...doc.skus], ['K-S', 'K-XL']);
  const none = product();
  await none.validate();
  assert.deepEqual([...none.skus], []);
});

test('product uses the products collection', () => {
  assert.equal(Product.collection.name, 'products');
});

test('a stock movement needs its store, product, variant, and reason, and is indexed for one product newest first', () => {
  const required = { store: oid(), product: oid(), variantId: oid(), previousQuantity: 5, quantity: 4, delta: -1, reason: 'storefront_order' };
  assert.equal(new StockMovement(required).validateSync(), undefined);
  for (const missing of ['store', 'product', 'variantId', 'reason']) {
    assert.notEqual(new StockMovement({ ...required, [missing]: undefined }).validateSync(), undefined, missing);
  }
  assert.deepEqual(StockMovement.schema.indexes()[0][0], { store: 1, product: 1, changedAt: -1 });
});
