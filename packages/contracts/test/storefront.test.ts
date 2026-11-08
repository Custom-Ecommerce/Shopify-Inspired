import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  storefrontProductSummarySchema,
  storefrontProductListResponseSchema,
  storefrontStoreByKeyResponseSchema,
  STOREFRONT_PRODUCTS_MAX_LIMIT,
  STOREFRONT_SLUG_PATTERN,
  STOREFRONT_DOMAIN_PATTERN,
} from '../src';

const summary = {
  id: 'p1',
  slug: 'blue-shirt',
  title: 'Blue shirt',
  currency: 'PKR' as const,
  price: 1500,
  compareAtPrice: null,
  stockStatus: 'in_stock' as const,
  defaultVariantId: 'v1',
  hasVariants: false,
  primaryImage: { url: 'https://res.cloudinary.com/x/a.jpg', alt: 'Blue shirt' },
  categories: [{ id: 'c1', slug: 'shirts', name: 'Shirts' }],
  avgRating: 0,
  reviewCount: 0,
};

test('product summary accepts the storefront shape', () => {
  assert.equal(storefrontProductSummarySchema.safeParse(summary).success, true);
});

test('product summary rejects a negative price and an unknown stock status', () => {
  assert.equal(storefrontProductSummarySchema.safeParse({ ...summary, price: -1 }).success, false);
  assert.equal(storefrontProductSummarySchema.safeParse({ ...summary, stockStatus: 'gone' }).success, false);
});

test('list envelope requires pagination fields', () => {
  assert.equal(
    storefrontProductListResponseSchema.safeParse({ data: [summary], page: 1, totalPages: 1, totalDocs: 1, limit: 24 }).success,
    true,
  );
  assert.equal(storefrontProductListResponseSchema.safeParse({ data: [summary] }).success, false);
});

test('store by-key envelope accepts a status-only payload', () => {
  assert.equal(storefrontStoreByKeyResponseSchema.safeParse({ data: { status: 'suspended' } }).success, true);
  assert.equal(storefrontStoreByKeyResponseSchema.safeParse({ data: { status: 'active' } }).success, false);
});

test('limits and key patterns', () => {
  assert.equal(STOREFRONT_PRODUCTS_MAX_LIMIT, 48);
  assert.equal(STOREFRONT_SLUG_PATTERN.test('my-store'), true);
  assert.equal(STOREFRONT_SLUG_PATTERN.test('Bad Key'), false);
  assert.equal(STOREFRONT_DOMAIN_PATTERN.test('shop.example.com'), true);
  assert.equal(STOREFRONT_DOMAIN_PATTERN.test('localhost'), false);
});
