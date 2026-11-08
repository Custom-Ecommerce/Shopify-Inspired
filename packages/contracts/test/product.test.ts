
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productSchema, productVariantsInputSchema, variantTitle } from '../src/product';
import { failingPaths } from './helpers';

const NOW = '2026-10-01T00:00:00.000Z';
const VARIANT = '65a0000000000000000000e1';

function variant(overrides: Record<string, unknown> = {}) {
  return {
    id: VARIANT,
    title: 'Default',
    sku: null,
    barcode: null,
    price: 2500,
    compareAtPrice: 3000,
    trackQuantity: true,
    stockQuantity: 12,
    lowStockThreshold: null,
    optionValues: [],
    imageId: null,
    position: 0,
    ...overrides,
  };
}

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: '65a000000000000000000003',
    store: '65a000000000000000000001',
    title: 'Shirt',
    slug: 'shirt',
    categories: [{ id: '65a000000000000000000004', name: 'Tops' }],
    media: [{ id: '65a000000000000000000008', url: 'https://cdn.example.com/a.jpg' }],
    highlights: [{ text: 'Cotton' }],
    options: [],
    variants: [variant()],
    minPrice: 2500,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

test('a populated product, as the dashboard reads it, parses', () => {
  assert.equal(productSchema.safeParse(product()).success, true);
});

test('the wire identity is id, not _id', () => {
  assert.deepEqual(failingPaths(productSchema.safeParse(product({ id: 'nope' }))), ['id']);
});

test('a negative or decimal variant price is reported against that price', () => {
  assert.deepEqual(failingPaths(productSchema.safeParse(product({ variants: [variant({ price: -1 })] }))), ['variants.0.price']);
  assert.deepEqual(failingPaths(productSchema.safeParse(product({ variants: [variant({ price: 10.5 })] }))), ['variants.0.price']);
});

test('a product with no variant is refused', () => {
  assert.deepEqual(failingPaths(productSchema.safeParse(product({ variants: [] }))), ['variants']);
});

test('highlights are rows with text, so plain strings are rejected', () => {
  assert.deepEqual(failingPaths(productSchema.safeParse(product({ highlights: ['Cotton'] }))), ['highlights.0']);
});

test('an unpopulated ObjectId relation is also accepted', () => {
  const ids = product({ categories: ['65a000000000000000000004'], media: ['65a000000000000000000008'] });
  assert.equal(productSchema.safeParse(ids).success, true);
});

const sizes = { name: 'Size', values: ['S', 'M'] };
const valid = (body: unknown) => productVariantsInputSchema.safeParse(body).success;

test('a product with no options has exactly one variant, with no option values', () => {
  assert.equal(valid({ variants: [{ price: 100 }] }), true);
  assert.equal(valid({ variants: [{ price: 100 }, { price: 200 }] }), false);
  assert.equal(valid({ variants: [] }), false);
  assert.equal(valid({ variants: [{ price: 100, optionValues: ['S'] }] }), false);
});

test('at most 3 options and 100 variants', () => {
  const option = (name: string) => ({ name, values: ['A'] });
  const four = [option('a'), option('b'), option('c'), option('d')];
  assert.equal(valid({ options: four, variants: [{ price: 1, optionValues: ['A', 'A', 'A', 'A'] }] }), false);

  const values = Array.from({ length: 11 }, (_, index) => 'v' + index);
  const combos = values.flatMap((a) => values.map((b) => [a, b]));
  const options = [{ name: 'a', values }, { name: 'b', values }];
  assert.equal(valid({ options, variants: combos.slice(0, 100).map((optionValues) => ({ price: 1, optionValues })) }), true);
  assert.equal(valid({ options, variants: combos.slice(0, 101).map((optionValues) => ({ price: 1, optionValues })) }), false);
});

test('option names and values are unique ignoring case, and within their limits', () => {
  const variants = [{ price: 1, optionValues: ['S'] }];
  assert.equal(valid({ options: [{ name: 'Size', values: ['S', 's'] }], variants }), false);
  assert.equal(
    valid({ options: [{ name: 'Size', values: ['S'] }, { name: 'SIZE', values: ['S'] }], variants: [{ price: 1, optionValues: ['S', 'S'] }] }),
    false,
  );
  assert.equal(valid({ options: [{ name: 'x'.repeat(41), values: ['S'] }], variants }), false);
  assert.equal(valid({ options: [{ name: 'Size', values: [] }], variants }), false);
  assert.equal(valid({ options: [{ name: 'Size', values: ['x'.repeat(61)] }], variants: [{ price: 1, optionValues: ['x'.repeat(61)] }] }), false);
});

test('option values must match the options, in order and in number', () => {
  assert.equal(valid({ options: [sizes], variants: [{ price: 1, optionValues: ['S'] }] }), true);
  assert.equal(valid({ options: [sizes], variants: [{ price: 1, optionValues: ['XL'] }] }), false);
  assert.equal(valid({ options: [sizes], variants: [{ price: 1, optionValues: [] }] }), false);
  assert.equal(valid({ options: [sizes], variants: [{ price: 1, optionValues: ['S', 'M'] }] }), false);
});

test('two variants cannot have the same options', () => {
  assert.equal(valid({ options: [sizes], variants: [{ price: 1, optionValues: ['S'] }, { price: 2, optionValues: ['S'] }] }), false);
});

test('the price rules run on the rounded value, and a store or unknown field is refused', () => {
  const parsed = productVariantsInputSchema.parse({ variants: [{ price: 0.5, compareAtPrice: 2.4 }] });
  assert.equal(parsed.variants[0].price, 1);
  assert.equal(parsed.variants[0].compareAtPrice, 2);
  assert.equal(valid({ variants: [{ price: 100, compareAtPrice: 100 }] }), false);
  assert.equal(valid({ variants: [{ price: -1 }] }), false);
  assert.equal(valid({ variants: [{ price: 100, stockQuantity: 1.5 }] }), false);
  assert.equal(valid({ variants: [{ price: 100, stockQuantity: -1 }] }), false);
  assert.equal(valid({ variants: [{ price: 100, title: 'Mine' }] }), false);
  assert.equal(valid({ variants: [{ price: 100 }], store: '65a000000000000000000001' }), false);
});

test('a variant is titled by its option values, or Default', () => {
  assert.equal(variantTitle([]), 'Default');
  assert.equal(variantTitle(['M']), 'M');
  assert.equal(variantTitle(['M', 'Red']), 'M / Red');
});
