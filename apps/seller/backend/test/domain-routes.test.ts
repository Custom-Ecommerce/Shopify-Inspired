import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { AuditLog, signSession, Store, User } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { useMemoryAuthLimits } from '@/lib/account-support';
import { setPlanLoader, type EffectivePlan } from '../src/lib/plan';
import { createFakeDnsResolver, setDnsResolver, type DnsResolverPort } from '../src/lib/domain-dns';
import { createStubVercelDomains, createVercelDomains, setVercelDomains, type VercelDomainsPort } from '../src/lib/domain-vercel';

// S7-B5 (D-118): domain connect, verify, disconnect and the state read. Models are stubbed in memory; DNS and Vercel are the fakes. No database.

const SECRET = 'x'.repeat(40);
const USER_A = '65a000000000000000000001';
const USER_B = '65a000000000000000000002';
const ADMIN = '65a000000000000000000003';
const STORE_A = '65a000000000000000000011';
const STORE_B = '65a000000000000000000012';
const T0 = new Date('2026-11-14T10:00:00Z');
const HOST = 'shop.zara.pk';

const StoreModel = Store as any;
const AuditModel = AuditLog as any;
const UserModel = User as any;

type Ctx = { params: Promise<{ id: string }> };
let stores: Record<string, Record<string, any>>;
let audits: Array<Record<string, any>> = [];
let tokenA = '';
let tokenB = '';
let tokenAdmin = '';
let growth = true;
let restore: () => void = () => {};
let connect: (r: NextRequest, c: Ctx) => Promise<Response>;
let verify: (r: NextRequest, c: Ctx) => Promise<Response>;
let disconnect: (r: NextRequest, c: Ctx) => Promise<Response>;
let stateGET: (r: NextRequest, c: Ctx) => Promise<Response>;
let vercel: ReturnType<typeof createStubVercelDomains>;

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  tokenA = await signSession({ sub: USER_A, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenB = await signSession({ sub: USER_B, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenAdmin = await signSession({ sub: ADMIN, role: 'admin' }, SECRET, SELLER_AUDIENCE);
  connect = (await import('../src/app/api/stores/[id]/domain/connect/route')).POST;
  verify = (await import('../src/app/api/stores/[id]/domain/verify/route')).POST;
  disconnect = (await import('../src/app/api/stores/[id]/domain/disconnect/route')).POST;
  stateGET = (await import('../src/app/api/stores/[id]/domain/route')).GET;
});

const chain = (value: () => unknown) => {
  const q: any = { select: () => q, sort: () => q, lean: async () => value() };
  return q;
};
const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : String(a) === String(b));
/** A Mongo-like match of the equality filters the domain routes use ({domain: null} matches a missing field). */
const matches = (row: Record<string, any>, filter: Record<string, any>): boolean =>
  Object.entries(filter).every(([key, want]) => {
    if (key === '_id' && want && typeof want === 'object' && '$ne' in want) return String(row._id) !== String(want.$ne);
    if (want === null) return row[key] === undefined || row[key] === null;
    return same(row[key], want);
  });

const planOf = (customDomain: boolean): EffectivePlan => ({
  key: customDomain ? 'growth' : 'free',
  name: customDomain ? 'Growth' : 'Free',
  status: 'active',
  subscribedPlanKey: customDomain ? 'growth' : null,
  limits: { stores: 1, products: 10, staffSeats: 0, apiKeys: 0, customDomain, premiumThemes: false },
  periodEnd: null,
  graceUntil: null,
  daysLeft: null,
  fallbackLimits: false,
});

beforeEach(() => {
  stores = {
    [STORE_A]: { _id: STORE_A, owner: USER_A, slug: 'zara', name: 'Zara Lawn', status: 'active', customDomainStatus: 'unset', updatedAt: T0 },
    [STORE_B]: { _id: STORE_B, owner: USER_B, slug: 'bilal', name: 'Bilal Shoes', status: 'active', customDomainStatus: 'unset', updatedAt: T0 },
  };
  audits = [];
  growth = true;
  process.env.STOREFRONT_URL = 'https://markazify.com';
  process.env.CUSTOM_DOMAIN_CNAME_TARGET = 'cname.markazify.com';
  delete process.env.CUSTOM_DOMAIN_A_TARGET;
  const saved = {
    connect: (mongoose as any).connect,
    fetch: globalThis.fetch,
    store: Object.fromEntries(['findOne', 'findOneAndUpdate', 'exists', 'findById'].map((m) => [m, StoreModel[m]])),
    audit: AuditModel.create,
    user: UserModel.findById,
  };
  (mongoose as any).connect = async () => mongoose;
  globalThis.fetch = (async () => new Response('{}', { status: 200 })) as typeof fetch;
  StoreModel.findOne = (filter: any) =>
    chain(() => {
      const row = stores[String(filter._id)];
      if (!row || (filter.owner !== undefined && !same(row.owner, filter.owner))) return null;
      return structuredClone(row);
    });
  StoreModel.findById = (id: unknown) => chain(() => (stores[String(id)] ? { slug: stores[String(id)]!.slug } : null));
  StoreModel.exists = async (filter: any) => {
    if ('domain' in filter) return Object.values(stores).find((row) => matches(row, filter)) ? { _id: 'x' } : null;
    return stores[String(filter._id)] && same(stores[String(filter._id)]!.owner, filter.owner) ? { _id: filter._id } : null;
  };
  StoreModel.findOneAndUpdate = (filter: any, update: any) =>
    chain(() => {
      const row = stores[String(filter._id)];
      if (!row || !matches(row, filter)) return null;
      Object.assign(row, structuredClone(update.$set ?? {}));
      for (const key of Object.keys(update.$unset ?? {})) delete row[key];
      row.updatedAt = new Date(row.updatedAt.getTime() + 1000);
      return structuredClone(row);
    });
  AuditModel.create = async (doc: Record<string, any>) => {
    audits.push(doc);
    return { _id: new mongoose.Types.ObjectId() };
  };
  UserModel.findById = () => chain(() => ({ emailVerifiedAt: T0 }));
  setPlanLoader(async () => planOf(growth));
  useMemoryAuthLimits();
  vercel = createStubVercelDomains();
  setVercelDomains(vercel);
  setDnsResolver(createFakeDnsResolver());
  restore = () => {
    (mongoose as any).connect = saved.connect;
    globalThis.fetch = saved.fetch;
    for (const [m, fn] of Object.entries(saved.store)) StoreModel[m] = fn;
    AuditModel.create = saved.audit;
    UserModel.findById = saved.user;
    setPlanLoader(null);
    setVercelDomains(null);
    setDnsResolver(null);
    delete process.env.STOREFRONT_URL;
    delete process.env.CUSTOM_DOMAIN_CNAME_TARGET;
  };
});

afterEach(() => restore());

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (id: string, token: string | null, body?: unknown, method = 'POST') =>
  new NextRequest('http://seller.test/api/stores/' + id + '/domain', {
    method,
    headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const doConnect = (domain: unknown, token: string | null = tokenA, id = STORE_A) => connect(req(id, token, { domain }), params(id));
const doVerify = (token: string | null = tokenA, id = STORE_A, body: unknown = {}) => verify(req(id, token, body), params(id));
const doDisconnect = (token: string | null = tokenA, id = STORE_A) => disconnect(req(id, token), params(id));
const json = async (res: Response) => (await res.json()) as any;

const dnsRight = (token: string) => createFakeDnsResolver({ txt: { ['_markazify-verify.' + HOST]: [token] }, cname: { [HOST]: ['cname.markazify.com.'] } });

// ------------------------------------------------------------------------------------------------------- connect

test('connect: the records come back (CNAME and TXT), the status is pending, the token is stored and the audit is written', async () => {
  const res = await doConnect(' Shop.Zara.PK ');
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.domain, HOST);
  assert.equal(body.customDomainStatus, 'pending');
  assert.equal(body.planAllowsCustomDomain, true);
  assert.equal(body.vercelConfigured, false);
  const token = stores[STORE_A]!.domainToken as string;
  assert.match(token, /^mz-[0-9a-f]{36}$/);
  assert.deepEqual(body.dnsRecords, [
    { type: 'CNAME', name: HOST, value: 'cname.markazify.com' },
    { type: 'TXT', name: '_markazify-verify.' + HOST, value: token },
  ]);
  assert.equal(stores[STORE_A]!.domain, HOST);
  assert.equal(audits[0]!.action, 'store.domain_connect');
});

test('connect: an apex host with an A target gets the A record', async () => {
  process.env.CUSTOM_DOMAIN_A_TARGET = '76.76.21.21';
  const body = await json(await doConnect('zara.pk'));
  assert.deepEqual(body.dnsRecords[0], { type: 'A', name: 'zara.pk', value: '76.76.21.21' });
});

test('connect: the same host again changes nothing and keeps the token; a new host resets to pending with a NEW token', async () => {
  await doConnect(HOST);
  const first = stores[STORE_A]!.domainToken;
  stores[STORE_A]!.customDomainStatus = 'verified';
  const again = await doConnect(HOST);
  assert.equal(again.status, 200);
  assert.equal(stores[STORE_A]!.domainToken, first);
  assert.equal(stores[STORE_A]!.customDomainStatus, 'verified');
  const changed = await json(await doConnect('www.zara.pk'));
  assert.equal(changed.customDomainStatus, 'pending');
  assert.notEqual(stores[STORE_A]!.domainToken, first);
  assert.deepEqual(vercel.calls, [{ op: 'remove', host: HOST }], 'the verified old host was taken off Vercel');
});

test('connect: a bad host is a 400 DOMAIN_INVALID naming the field, and nothing is written', async () => {
  for (const bad of ['https://shop.zara.pk/', 'localhost', '10.0.0.1', 'markazify.com', 'zara.markazify.com']) {
    const res = await doConnect(bad);
    assert.equal(res.status, 400, bad);
    const body = await json(res);
    assert.equal(body.code, 'DOMAIN_INVALID');
    assert.equal(body.field, 'domain');
  }
  assert.equal(stores[STORE_A]!.domain, undefined);
});

test('connect: extra body fields are refused (strict contract)', async () => {
  const res = await connect(req(STORE_A, tokenA, { domain: HOST, customDomainStatus: 'verified' }), params(STORE_A));
  assert.equal(res.status, 400);
  assert.equal((await json(res)).field, 'customDomainStatus');
});

test('connect: no session is 401, an admin is 403, another seller\'s store is 403 and nothing of it changes', async () => {
  assert.equal((await doConnect(HOST, null)).status, 401);
  assert.equal((await doConnect(HOST, tokenAdmin)).status, 403);
  const foreign = await doConnect(HOST, tokenB, STORE_A);
  assert.equal(foreign.status, 403);
  assert.equal(stores[STORE_A]!.domain, undefined);
  assert.equal(await (async () => (await doConnect(HOST, tokenA, '65a0000000000000000000ff')).status)(), 403);
});

test('connect: a Free plan seller is refused with PLAN_LIMIT_REACHED (customDomain), after the ownership checks', async () => {
  growth = false;
  const res = await doConnect(HOST);
  assert.equal(res.status, 403);
  const body = await json(res);
  assert.equal(body.code, 'PLAN_LIMIT_REACHED');
  assert.equal(body.limitKind, 'customDomain');
  assert.equal(stores[STORE_A]!.domain, undefined);
  // A foreign store on a Free plan is still the ownership answer, not the plan one.
  const foreign = await doConnect(HOST, tokenB, STORE_A);
  assert.equal(foreign.status, 403);
  assert.equal((await json(foreign)).code === 'PLAN_LIMIT_REACHED', false);
});

test('connect: one host for one store: a host held by another store is 409 DOMAIN_TAKEN and never says whose', async () => {
  stores[STORE_B]!.domain = HOST;
  stores[STORE_B]!.customDomainStatus = 'verified';
  const res = await doConnect(HOST);
  assert.equal(res.status, 409);
  const text = JSON.stringify(await json(res));
  assert.match(text, /DOMAIN_TAKEN/);
  assert.equal(text.includes(STORE_B), false);
  assert.equal(text.includes('bilal'), false);
  assert.equal(stores[STORE_A]!.domain, undefined);
});

test('connect: a duplicate-key error from the unique index (a race) is also 409 DOMAIN_TAKEN', async () => {
  const original = StoreModel.findOneAndUpdate;
  StoreModel.findOneAndUpdate = () => chain(() => Promise.reject(Object.assign(new Error('E11000 duplicate key'), { code: 11000 })));
  const res = await doConnect(HOST);
  StoreModel.findOneAndUpdate = original;
  assert.equal(res.status, 409);
  assert.equal((await json(res)).code, 'DOMAIN_TAKEN');
});

// ------------------------------------------------------------------------------------------------------- state

test('GET state: the owner sees the records and the token inside the TXT record; another seller gets 403', async () => {
  await doConnect(HOST);
  const own = await stateGET(req(STORE_A, tokenA, undefined, 'GET'), params(STORE_A));
  assert.equal(own.status, 200);
  assert.equal((await json(own)).dnsRecords.length, 2);
  const other = await stateGET(req(STORE_A, tokenB, undefined, 'GET'), params(STORE_A));
  assert.equal(other.status, 403);
  assert.equal(JSON.stringify(await json(other)).includes(stores[STORE_A]!.domainToken), false);
});

// ------------------------------------------------------------------------------------------------------- verify

async function connected(): Promise<string> {
  await doConnect(HOST);
  return stores[STORE_A]!.domainToken as string;
}

test('verify: token and target both right: verified, the Vercel add is called once, the storefront is not asked for anything else', async () => {
  const token = await connected();
  setDnsResolver(dnsRight(token));
  const res = await doVerify();
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.customDomainStatus, 'verified');
  assert.equal(body.failureReason, null);
  assert.ok(body.checkedAt);
  assert.deepEqual(vercel.calls, [{ op: 'add', host: HOST }]);
  assert.equal(stores[STORE_A]!.customDomainStatus, 'verified');
  assert.equal(audits.at(-1)!.action, 'store.domain_verified');
});

test('verify: the TXT token missing is failed / token_missing with a plain message, and Vercel is never called', async () => {
  await connected();
  setDnsResolver(createFakeDnsResolver({ cname: { [HOST]: ['cname.markazify.com'] } }));
  const body = await json(await doVerify());
  assert.equal(body.customDomainStatus, 'failed');
  assert.equal(body.failureReason, 'token_missing');
  assert.match(body.failureMessage, /TXT/);
  assert.equal(vercel.calls.length, 0);
});

test('verify: the token right but the CNAME wrong is failed / target_wrong', async () => {
  const token = await connected();
  setDnsResolver(createFakeDnsResolver({ txt: { ['_markazify-verify.' + HOST]: [token] }, cname: { [HOST]: ['someone-else.example.net'] } }));
  const body = await json(await doVerify());
  assert.equal(body.customDomainStatus, 'failed');
  assert.equal(body.failureReason, 'target_wrong');
});

test('verify: a resolver error and a resolver timeout are failed with their own reasons', async () => {
  await connected();
  setDnsResolver(createFakeDnsResolver({ failing: { ['_markazify-verify.' + HOST]: 'error' } }));
  assert.equal((await json(await doVerify())).failureReason, 'dns_error');
  setDnsResolver(createFakeDnsResolver({ failing: { ['_markazify-verify.' + HOST]: 'timeout' } }));
  assert.equal((await json(await doVerify())).failureReason, 'dns_timeout');
});

test('verify: a client-supplied result is refused (strict empty body) and nothing is verified', async () => {
  await connected();
  const res = await doVerify(tokenA, STORE_A, { customDomainStatus: 'verified' });
  assert.equal(res.status, 400);
  assert.equal(stores[STORE_A]!.customDomainStatus, 'pending');
});

test('verify: before a domain is connected it is 409 DOMAIN_NOT_SET', async () => {
  const res = await doVerify();
  assert.equal(res.status, 409);
  assert.equal((await json(res)).code, 'DOMAIN_NOT_SET');
});

test('verify: another seller is 403, a Free plan seller is refused, and neither reaches DNS', async () => {
  const token = await connected();
  const dns = dnsRight(token);
  setDnsResolver(dns);
  assert.equal((await doVerify(tokenB, STORE_A)).status, 403);
  growth = false;
  const res = await doVerify();
  assert.equal(res.status, 403);
  assert.equal((await json(res)).limitKind, 'customDomain');
  assert.equal(dns.asked.length, 0);
});

test('verify: a failed check keeps a verified store verified (only checkedAt and the reason are recorded)', async () => {
  const token = await connected();
  setDnsResolver(dnsRight(token));
  await doVerify();
  setDnsResolver(createFakeDnsResolver({ failing: { ['_markazify-verify.' + HOST]: 'timeout' } }));
  const body = await json(await doVerify());
  assert.equal(body.customDomainStatus, 'verified');
  assert.equal(body.failureReason, 'dns_timeout');
  assert.equal(stores[STORE_A]!.customDomainStatus, 'verified');
  assert.equal(vercel.calls.length, 1, 'no second Vercel call and no removal');
});

test('verify: the 11th check in an hour is 429 and never reaches DNS', async () => {
  const token = await connected();
  const dns = dnsRight(token);
  setDnsResolver(dns);
  for (let i = 0; i < 10; i += 1) assert.equal((await doVerify()).status, 200);
  const asked = dns.asked.length;
  const res = await doVerify();
  assert.equal(res.status, 429);
  assert.equal(dns.asked.length, asked);
});

test('verify: a Vercel add that fails leaves the store failed / vercel_failed, never verified', async () => {
  const token = await connected();
  setDnsResolver(dnsRight(token));
  const failing: VercelDomainsPort = { configured: true, addDomain: async () => ({ ok: false, reason: 'vercel_http_500' }), removeDomain: async () => ({ ok: true }) };
  setVercelDomains(failing);
  const body = await json(await doVerify());
  assert.equal(body.customDomainStatus, 'failed');
  assert.equal(body.failureReason, 'vercel_failed');
  assert.equal(body.vercelConfigured, true);
  assert.equal(stores[STORE_A]!.customDomainStatus, 'failed');
});

test('verify: a domain changed between the read and the write is 409 and the new state is untouched', async () => {
  const token = await connected();
  const slow: DnsResolverPort = {
    resolveTxt: async () => {
      stores[STORE_A]!.domain = 'other.zara.pk';
      return [token];
    },
    resolveCname: async () => ['cname.markazify.com'],
    resolve4: async () => [],
  };
  setDnsResolver(slow);
  const res = await doVerify();
  assert.equal(res.status, 409);
  assert.equal(stores[STORE_A]!.customDomainStatus, 'pending');
});

// ------------------------------------------------------------------------------------------------------- disconnect

test('disconnect: clears the domain, status, token and reason, removes the host from Vercel and is audited', async () => {
  const token = await connected();
  setDnsResolver(dnsRight(token));
  await doVerify();
  const res = await doDisconnect();
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.domain, null);
  assert.equal(body.customDomainStatus, 'unset');
  assert.deepEqual(body.dnsRecords, []);
  for (const key of ['domain', 'domainToken', 'domainCheckedAt', 'domainFailureReason']) assert.equal(stores[STORE_A]![key], undefined, key);
  assert.deepEqual(vercel.calls.at(-1), { op: 'remove', host: HOST });
  assert.equal(audits.at(-1)!.action, 'store.domain_disconnect');
});

test('disconnect: works on a Free plan (a seller who lost the feature can leave), refuses another seller, and an empty store is a no-op', async () => {
  await connected();
  assert.equal((await doDisconnect(tokenB, STORE_A)).status, 403);
  assert.equal(stores[STORE_A]!.domain, HOST);
  growth = false;
  assert.equal((await doDisconnect()).status, 200);
  assert.equal(stores[STORE_A]!.domain, undefined);
  const before = vercel.calls.length;
  assert.equal((await doDisconnect()).status, 200);
  assert.equal(vercel.calls.length, before);
});

test('disconnect: a Vercel removal that fails is 502 and the store keeps its domain', async () => {
  await connected();
  setVercelDomains({ configured: true, addDomain: async () => ({ ok: true }), removeDomain: async () => ({ ok: false, reason: 'vercel_timeout' }) });
  const res = await doDisconnect();
  assert.equal(res.status, 502);
  assert.equal((await json(res)).code, 'DOMAIN_REMOVE_FAILED');
  assert.equal(stores[STORE_A]!.domain, HOST);
});

test('the real Vercel port is only used with both settings: without them the stub answers and records', async () => {
  setVercelDomains(null);
  const { getVercelDomains } = await import('../src/lib/domain-vercel');
  assert.equal(getVercelDomains({}).configured, false);
  assert.equal(getVercelDomains({ VERCEL_API_TOKEN: 't' }).configured, false);
  assert.equal(getVercelDomains({ VERCEL_API_TOKEN: 't', VERCEL_PROJECT_ID: 'p' }).configured, true);
  assert.ok(createVercelDomains);
});
