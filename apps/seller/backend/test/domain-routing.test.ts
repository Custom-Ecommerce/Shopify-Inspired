import { test, beforeEach, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { Store } from '@/lib/services';
import { setPlanLoader } from '../src/lib/plan';
import { buildStoreLookup } from '../src/lib/storefront/store-key';
import { toStorefrontStoreDto, verifiedDomainOf } from '../src/lib/storefront/store-dto';
import { domainCacheHeaders } from '../src/lib/storefront/domain-cache';

// S7-B6 (D-118): the public lookup of a store by its custom domain. The models are stubbed in memory: the lookup filter is applied to the stores
// below, so "unverified does not resolve" is the filter the route really builds, not a copy of it. No database.

const StoreModel = Store as any;
type Row = Record<string, any>;

const ZARA: Row = { _id: '65a000000000000000000011', slug: 'zara', name: 'Zara Lawn', status: 'active', domain: 'shop.zara.pk', customDomainStatus: 'verified', storefront: { redirectToCustomDomain: true } };
const BILAL: Row = { _id: '65a000000000000000000012', slug: 'bilal', name: 'Bilal Shoes', status: 'active', domain: 'shop.bilal.pk', customDomainStatus: 'verified', storefront: {} };

let stores: Row[];
let filters: Array<Record<string, unknown>>;
let byKeyGET: (r: NextRequest, c: { params: Promise<{ key: string }> }) => Promise<Response>;
let restore: () => void;

before(async () => {
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  byKeyGET = (await import('../src/app/api/storefront/v1/stores/by-key/[key]/route')).GET;
});

beforeEach(() => {
  stores = [structuredClone(ZARA), structuredClone(BILAL)];
  filters = [];
  const saved = { connect: (mongoose as any).connect, findOne: StoreModel.findOne };
  (mongoose as any).connect = async () => mongoose;
  StoreModel.findOne = (filter: Record<string, unknown>) => {
    filters.push(filter);
    // A Mongo-like match of equality filters.
    const row = stores.find((candidate) => Object.entries(filter).every(([key, want]) => candidate[key] === want));
    return { lean: async () => (row ? structuredClone(row) : null) };
  };
  restore = () => {
    (mongoose as any).connect = saved.connect;
    StoreModel.findOne = saved.findOne;
    setPlanLoader(null);
  };
});
afterEach(() => restore());

const lookup = (host: string, headers: Record<string, string> = {}) =>
  byKeyGET(new NextRequest('http://seller.test/api/storefront/v1/stores/by-key/' + encodeURIComponent(host) + '?by=domain', { headers }), { params: Promise.resolve({ key: host }) });

// ------------------------------------------------------------------------------------------------------- the lookup

test('a verified domain resolves to its store, with the domain in the record and a cache tag keyed by the host', async () => {
  const res = await lookup('shop.zara.pk');
  assert.equal(res.status, 200);
  const { data } = (await res.json()) as { data: any };
  assert.equal(data.id, ZARA._id);
  assert.equal(data.slug, 'zara');
  assert.equal(data.customDomain, 'shop.zara.pk');
  assert.equal(data.redirectToCustomDomain, true);
  assert.equal(res.headers.get('Cache-Tag'), 'domain-resolve:shop.zara.pk');
  assert.equal(res.headers.get('Vercel-Cache-Tag'), 'domain-resolve:shop.zara.pk');
  assert.match(res.headers.get('Cache-Control') ?? '', /public/);
  assert.deepEqual(filters, [{ domain: 'shop.zara.pk', customDomainStatus: 'verified' }]);
});

test('the host is normalised with the S7-B5 helper: case, a port-less punycode form, and what it refuses never reaches the database', async () => {
  assert.equal((await lookup('SHOP.Zara.PK')).status, 200);
  assert.deepEqual(filters.at(-1), { domain: 'shop.zara.pk', customDomainStatus: 'verified' });
  filters = [];
  for (const bad of ['localhost', '127.0.0.1', 'shop.localhost', 'a.internal', 'https://shop.zara.pk', 'shop.zara.pk:3000', 'x'.repeat(300) + '.com', 'markazify.com']) {
    process.env.STOREFRONT_URL = 'https://markazify.com';
    const res = await lookup(bad);
    assert.equal(res.status, 404, bad);
  }
  delete process.env.STOREFRONT_URL;
  assert.equal(filters.length, 0, 'none of them was queried');
  assert.equal(buildStoreLookup('bücher.de', 'domain')?.key, 'xn--bcher-kva.de');
});

test('unknown, pending, failed, unset and disconnected hosts all answer the SAME 404 as an unknown store, with no reason', async () => {
  stores.push({ _id: 'c', slug: 'pend', name: 'P', status: 'active', domain: 'pending.zara.pk', customDomainStatus: 'pending' });
  stores.push({ _id: 'd', slug: 'fail', name: 'F', status: 'active', domain: 'failed.zara.pk', customDomainStatus: 'failed' });
  stores.push({ _id: 'e', slug: 'gone', name: 'G', status: 'active', customDomainStatus: 'unset' });
  const bodies = new Set<string>();
  for (const host of ['nobody.example.org', 'pending.zara.pk', 'failed.zara.pk', 'gone.zara.pk', 'shop.zara.org']) {
    const res = await lookup(host);
    assert.equal(res.status, 404, host);
    bodies.add(JSON.stringify(await res.json()));
    assert.equal(res.headers.get('Cache-Tag'), null, 'an error carries no tag that would say the host exists');
  }
  assert.equal(bodies.size, 1, 'one body for every reason');
  const unknownStore = await byKeyGET(new NextRequest('http://seller.test/x?by=slug'), { params: Promise.resolve({ key: 'no-such-store' }) });
  assert.equal(JSON.stringify(await unknownStore.json()), [...bodies][0]);
});

test('a disconnected domain stops resolving once the store no longer holds it (the purge then drops the cached answer)', async () => {
  assert.equal((await lookup('shop.zara.pk')).status, 200);
  delete stores[0]!.domain;
  stores[0]!.customDomainStatus = 'unset';
  assert.equal((await lookup('shop.zara.pk')).status, 404);
});

test('two stores on two hosts never mix: each host gets its own store and its own cache tag', async () => {
  const a = (await (await lookup('shop.zara.pk')).json()) as { data: any };
  const bRes = await lookup('shop.bilal.pk');
  const b = (await bRes.json()) as { data: any };
  assert.equal(a.data.slug, 'zara');
  assert.equal(b.data.slug, 'bilal');
  assert.notEqual(a.data.id, b.data.id);
  assert.equal(b.data.customDomain, 'shop.bilal.pk');
  assert.equal(b.data.redirectToCustomDomain, false, 'one store setting is not another one');
  assert.equal(bRes.headers.get('Cache-Tag'), 'domain-resolve:shop.bilal.pk');
});

test('a store that is not active answers its status only, by domain too (nothing else is exposed)', async () => {
  stores[0]!.status = 'suspended';
  const res = await lookup('shop.zara.pk');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { data: { status: 'suspended' } });
});

test('a lookup by domain never honours a preview credential', async () => {
  stores[0]!.status = 'pending';
  const res = await lookup('shop.zara.pk', { 'x-markaz-preview': 'a.b.c', authorization: 'Bearer a.b.c' });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { data: any; preview?: boolean };
  assert.deepEqual(body, { data: { status: 'pending' } });
  assert.equal(res.headers.get('Cache-Control')?.includes('no-store'), false);
});

test('a seller whose plan lapsed keeps the verified domain resolving: the lookup never reads the plan (decision: a live shop is not cut off silently)', async () => {
  setPlanLoader(async () => {
    throw new Error('the plan must not be read on a shopper request');
  });
  assert.equal((await lookup('shop.zara.pk')).status, 200);
});

// ------------------------------------------------------------------------------------------------------- the record

test('the public record carries the domain only when it is verified, and the redirect flag only with a verified domain', async () => {
  assert.equal(verifiedDomainOf({ domain: 'shop.zara.pk', customDomainStatus: 'verified' }), 'shop.zara.pk');
  for (const status of ['pending', 'failed', 'unset', undefined, null]) assert.equal(verifiedDomainOf({ domain: 'shop.zara.pk', customDomainStatus: status as string | null | undefined }), null, String(status));
  assert.equal(verifiedDomainOf({ domain: '', customDomainStatus: 'verified' }), null);
  assert.equal(verifiedDomainOf({ domain: null, customDomainStatus: 'verified' }), null);

  const row = { _id: '65a000000000000000000011', slug: 'zara', name: 'Zara', storefront: { redirectToCustomDomain: true } };
  const pending = await toStorefrontStoreDto({ ...row, domain: 'shop.zara.pk', customDomainStatus: 'pending' });
  assert.equal(pending.customDomain, null, 'a pending domain is never public');
  assert.equal(pending.redirectToCustomDomain, false, 'and the redirect does nothing without a verified one');
  const verified = await toStorefrontStoreDto({ ...row, domain: 'shop.zara.pk', customDomainStatus: 'verified' });
  assert.equal(verified.customDomain, 'shop.zara.pk');
  assert.equal(verified.redirectToCustomDomain, true);
  const off = await toStorefrontStoreDto({ ...row, storefront: {}, domain: 'shop.zara.pk', customDomainStatus: 'verified' });
  assert.equal(off.redirectToCustomDomain, false, 'OFF by default');
  const none = await toStorefrontStoreDto(row);
  assert.equal(none.customDomain, null);
});

test('the cache headers keep the short public cache and add the tag of the host', () => {
  const headers = domainCacheHeaders('shop.zara.pk');
  assert.match(headers['Cache-Control']!, /^public, s-maxage=\d+/);
  assert.equal(headers['Cache-Tag'], 'domain-resolve:shop.zara.pk');
});
