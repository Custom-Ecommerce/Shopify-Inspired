import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { Category, Product, Store, User, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import type { AuthContext } from '@/lib/auth';
import { seedStoreDemoData } from '../src/lib/demo-data';
import { provisionStore } from '../src/lib/workspace';

const SELLER = '65a000000000000000000001';
const STORE_A = '65a000000000000000000011';
const STORE_B = '65a000000000000000000012';

type Doc = Record<string, unknown>;

interface StoreRow {
  _id: string;
  demoSeeded: boolean;
}

const mongooseStub = mongoose as unknown as { connect: () => Promise<unknown> };
const StoreStub = Store as unknown as {
  updateOne: (filter: { _id: string; demoSeeded?: unknown }, update: { $set: { demoSeeded: boolean } }) => Promise<{ modifiedCount: number }>;
  countDocuments: () => Promise<number>;
  create: (doc: Doc) => Promise<Doc>;
};
const CategoryStub = Category as unknown as {
  create: (doc: Doc) => Promise<Doc>;
  deleteOne: (filter: Doc) => Promise<unknown>;
};
const ProductStub = Product as unknown as { create: (doc: Doc) => Promise<Doc> };
const UserStub = User as unknown as { findById: () => { select: () => { lean: () => Promise<unknown> } } };

let stores: StoreRow[];
let categories: Doc[];
let products: Doc[];
let failProduct: boolean;
let restore: () => void;

beforeEach(() => {
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  stores = [
    { _id: STORE_A, demoSeeded: false },
    { _id: STORE_B, demoSeeded: false },
  ];
  categories = [];
  products = [];
  failProduct = false;

  const saved = {
    connect: mongooseStub.connect,
    update: StoreStub.updateOne,
    count: StoreStub.countDocuments,
    createStore: StoreStub.create,
    createCategory: CategoryStub.create,
    removeCategory: CategoryStub.deleteOne,
    createProduct: ProductStub.create,
    findUser: UserStub.findById,
  };

  mongooseStub.connect = async () => mongoose;
  StoreStub.updateOne = async (filter, update) => {
    const row = stores.find((candidate) => candidate._id === filter._id);
    if (!row || (filter.demoSeeded !== undefined && row.demoSeeded)) return { modifiedCount: 0 };
    row.demoSeeded = update.$set.demoSeeded;
    return { modifiedCount: 1 };
  };
  StoreStub.countDocuments = async () => 0;
  StoreStub.create = async (doc) => {
    stores.push({ _id: STORE_A.slice(0, -2) + '99', demoSeeded: false });
    return { ...doc, _id: STORE_A.slice(0, -2) + '99' };
  };
  CategoryStub.create = async (doc) => {
    const row = { ...doc, _id: 'cat' + categories.length };
    categories.push(row);
    return row;
  };
  CategoryStub.deleteOne = async (filter) => {
    categories = categories.filter((row) => row._id !== filter._id);
    return { deletedCount: 1 };
  };
  ProductStub.create = async (doc) => {
    if (failProduct) throw new Error('database went away');
    products.push(doc);
    return doc;
  };
  UserStub.findById = () => ({
    select: () => ({ lean: async () => ({ name: 'Seller', email: 's@example.test', accountStatus: 'active' }) }),
  });

  restore = () => {
    mongooseStub.connect = saved.connect;
    StoreStub.updateOne = saved.update;
    StoreStub.countDocuments = saved.count;
    StoreStub.create = saved.createStore;
    CategoryStub.create = saved.createCategory;
    CategoryStub.deleteOne = saved.removeCategory;
    ProductStub.create = saved.createProduct;
    UserStub.findById = saved.findUser;
  };
});

afterEach(() => restore());

const quietly = async (run: () => Promise<void>): Promise<void> => {
  const saved = console.error;
  console.error = () => {};
  try {
    await run();
  } finally {
    console.error = saved;
  }
};

test('a store gets one demo category and one demo draft product with a Default variant', async () => {
  await seedStoreDemoData(STORE_A);

  assert.equal(categories.length, 1);
  assert.equal(categories[0].isDemo, true);
  assert.equal(categories[0].store, STORE_A);

  assert.equal(products.length, 1);
  const demo = products[0];
  assert.equal(demo.store, STORE_A);
  assert.equal(demo.isDemo, true);
  assert.equal(demo.isPublished, false);
  assert.deepEqual(demo.categories, [categories[0]._id]);
  const variants = demo.variants as Array<{ title: string; price: number; stockQuantity: number }>;
  assert.deepEqual(variants.map((v) => v.title), ['Default']);
  assert.equal(demo.minPrice, variants[0].price);
  assert.equal(stores[0].demoSeeded, true);
});

test('a second run does not duplicate, and nothing comes back after the seller deletes the demo items', async () => {
  await seedStoreDemoData(STORE_A);
  await seedStoreDemoData(STORE_A);
  assert.equal(products.length, 1);

  products = [];
  categories = [];
  await seedStoreDemoData(STORE_A);
  assert.equal(products.length, 0);
  assert.equal(categories.length, 0);
});

test('each store is seeded into itself', async () => {
  await seedStoreDemoData(STORE_A);
  await seedStoreDemoData(STORE_B);
  assert.deepEqual(products.map((row) => row.store), [STORE_A, STORE_B]);
  assert.deepEqual(categories.map((row) => row.store), [STORE_A, STORE_B]);
  assert.deepEqual(products.map((row) => row.categories), [[categories[0]._id], [categories[1]._id]]);
});

test('a failed seed never throws, removes its category and leaves demoSeeded false', async () => {
  failProduct = true;
  await quietly(() => seedStoreDemoData(STORE_A));
  assert.equal(categories.length, 0);
  assert.equal(stores[0].demoSeeded, false);
});

test('provisionStore seeds the new store, and a seeding failure does not fail store creation', async () => {
  const ctx = { userId: SELLER, userObjectId: new mongoose.Types.ObjectId(SELLER), role: 'seller', actor: 'seller' } as AuthContext;

  const created = await provisionStore(ctx, 'Lawn House');
  assert.equal(created.ok, true);
  assert.equal(products.length, 1);

  failProduct = true;
  stores = [];
  await quietly(async () => {
    const second = await provisionStore(ctx, 'Zari House');
    assert.equal(second.ok, true);
  });
});

test('POST /api/stores seeds the store it creates, once', async () => {
  const secret = 'x'.repeat(40);
  process.env.SELLER_AUTH_SECRET = secret;
  const token = await signSession({ sub: SELLER, role: 'admin' }, secret, SELLER_AUDIENCE);
  const { POST } = await import('../src/app/api/stores/route');

  const res = await POST(
    new NextRequest('http://seller.test/api/stores', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Lawn House', slug: 'lawn-house', owner: SELLER }),
    }),
  );
  assert.equal(res.status, 201);
  const { doc } = (await res.json()) as { doc: { id: string } };
  assert.equal(products.length, 1);
  assert.equal(products[0].store, doc.id);
  assert.equal(products[0].isDemo, true);
});
