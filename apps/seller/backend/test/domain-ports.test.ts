import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDnsResolver, createNodeDnsResolver } from '../src/lib/domain-dns';
import { createStubVercelDomains, createVercelDomains, getVercelDomains } from '../src/lib/domain-vercel';
import { checkDomainDns, dnsRecordsFor, domainTargets, newDomainToken, toDomainState } from '../src/lib/domain-service';

// S7-B5: the pure domain service, the fake DNS resolver and the Vercel port with a fake fetch. No network.

const HOST = 'shop.zara.pk';
const TXT = '_markazify-verify.' + HOST;
const TARGETS = { cname: 'cname.markazify.com', a: '76.76.21.21' };

test('a token is random, prefixed and 39 characters', () => {
  const a = newDomainToken();
  assert.match(a, /^mz-[0-9a-f]{36}$/);
  assert.notEqual(a, newDomainToken());
});

test('the targets come from the two settings, lower-cased with no trailing dot; empty is null', () => {
  assert.deepEqual(domainTargets({ CUSTOM_DOMAIN_CNAME_TARGET: ' CNAME.Markazify.com. ', CUSTOM_DOMAIN_A_TARGET: '' }), { cname: 'cname.markazify.com', a: null });
  assert.deepEqual(domainTargets({}), { cname: null, a: null });
});

test('records: a subdomain gets the CNAME, an apex gets the A record, with only one target that one is used, and the TXT is always last', () => {
  assert.deepEqual(dnsRecordsFor(HOST, 'tok', TARGETS), [
    { type: 'CNAME', name: HOST, value: 'cname.markazify.com' },
    { type: 'TXT', name: TXT, value: 'tok' },
  ]);
  assert.equal(dnsRecordsFor('zara.pk', 'tok', TARGETS)[0]!.type, 'A');
  assert.equal(dnsRecordsFor(HOST, 'tok', { cname: null, a: '1.2.3.4' })[0]!.type, 'A');
  assert.equal(dnsRecordsFor('zara.pk', 'tok', { cname: 'c.markazify.com', a: null })[0]!.type, 'CNAME');
  assert.deepEqual(dnsRecordsFor(HOST, 'tok', { cname: null, a: null }), [{ type: 'TXT', name: TXT, value: 'tok' }]);
});

test('check: token and CNAME right passes (a trailing dot and case do not matter); an A record also passes', async () => {
  const cname = createFakeDnsResolver({ txt: { [TXT]: ['other', 'tok'] }, cname: { [HOST]: ['CNAME.markazify.com.'] } });
  assert.deepEqual(await checkDomainDns(cname, HOST, 'tok', TARGETS), { ok: true });
  const a = createFakeDnsResolver({ txt: { [TXT]: ['tok'] }, a: { [HOST]: ['76.76.21.21'] } });
  assert.deepEqual(await checkDomainDns(a, HOST, 'tok', TARGETS), { ok: true });
});

test('check: token missing, a different token, wrong target and no target are told apart', async () => {
  assert.deepEqual(await checkDomainDns(createFakeDnsResolver(), HOST, 'tok', TARGETS), { ok: false, reason: 'token_missing' });
  assert.deepEqual(await checkDomainDns(createFakeDnsResolver({ txt: { [TXT]: ['not-it'] } }), HOST, 'tok', TARGETS), { ok: false, reason: 'token_missing' });
  const wrong = createFakeDnsResolver({ txt: { [TXT]: ['tok'] }, cname: { [HOST]: ['elsewhere.net'] }, a: { [HOST]: ['9.9.9.9'] } });
  assert.deepEqual(await checkDomainDns(wrong, HOST, 'tok', TARGETS), { ok: false, reason: 'target_wrong' });
  assert.deepEqual(await checkDomainDns(createFakeDnsResolver({ txt: { [TXT]: ['tok'] } }), HOST, 'tok', TARGETS), { ok: false, reason: 'target_wrong' });
});

test('check: with no target configured the TXT token alone is enough (a development setup)', async () => {
  assert.deepEqual(await checkDomainDns(createFakeDnsResolver({ txt: { [TXT]: ['tok'] } }), HOST, 'tok', { cname: null, a: null }), { ok: true });
});

test('check: a resolver error and a timeout are reasons of their own and never throw', async () => {
  assert.deepEqual(await checkDomainDns(createFakeDnsResolver({ failing: { [TXT]: 'error' } }), HOST, 'tok', TARGETS), { ok: false, reason: 'dns_error' });
  assert.deepEqual(await checkDomainDns(createFakeDnsResolver({ failing: { [TXT]: 'timeout' } }), HOST, 'tok', TARGETS), { ok: false, reason: 'dns_timeout' });
  const plain = { resolveTxt: async () => { throw new Error('boom'); }, resolveCname: async () => [], resolve4: async () => [] };
  assert.deepEqual(await checkDomainDns(plain, HOST, 'tok', TARGETS), { ok: false, reason: 'dns_error' });
});

test('the real resolver can be built with a timeout (no lookup is made here)', () => {
  const resolver = createNodeDnsResolver(50);
  assert.equal(typeof resolver.resolveTxt, 'function');
  assert.equal(typeof resolver.resolveCname, 'function');
  assert.equal(typeof resolver.resolve4, 'function');
});

test('state: no domain is the empty state; the token shows only inside the TXT record; a stored reason has a message; junk is ignored', () => {
  const extra = { vercelConfigured: false, planAllowsCustomDomain: true, targets: TARGETS };
  assert.deepEqual(toDomainState(null, extra), { domain: null, customDomainStatus: 'unset', dnsRecords: [], failureReason: null, failureMessage: null, checkedAt: null, vercelConfigured: false, planAllowsCustomDomain: true, redirectToCustomDomain: false });
  const state = toDomainState({ domain: HOST, customDomainStatus: 'failed', domainToken: 'tok', domainFailureReason: 'target_wrong', domainCheckedAt: new Date('2026-11-14T10:00:00Z') }, extra);
  assert.equal(state.customDomainStatus, 'failed');
  assert.equal(state.failureReason, 'target_wrong');
  assert.match(state.failureMessage ?? '', /CNAME or A/);
  assert.equal(state.checkedAt, '2026-11-14T10:00:00.000Z');
  assert.equal(JSON.stringify(state).split('tok').length - 1, 1);
  const junk = toDomainState({ domain: HOST, customDomainStatus: 'weird', domainToken: 'tok', domainFailureReason: 'weird' }, extra);
  assert.equal(junk.customDomainStatus, 'pending');
  assert.equal(junk.failureReason, null);
  // A leftover reason of a store with no domain is not shown.
  assert.equal(toDomainState({ domainFailureReason: 'dns_error' }, extra).failureReason, null);
});

// ---------------------------------------------------------------------------------------------------- Vercel

type Seen = { url: string; method: string; headers: Record<string, string>; body: string | undefined };
function fakeFetch(respond: (url: string, method: string) => Response | Error) {
  const seen: Seen[] = [];
  const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
    seen.push({ url, method: String(init.method), headers: init.headers as Record<string, string>, body: init.body as string | undefined });
    const out = respond(url, String(init.method));
    if (out instanceof Error) throw out;
    return out;
  };
  return { seen, fetchImpl };
}
const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('vercel: add posts the host to the project with the bearer token in a header, and the token is in no URL or body', async () => {
  const { seen, fetchImpl } = fakeFetch(() => jsonResponse(200, { name: HOST }));
  const port = createVercelDomains({ token: 'SECRET-TOKEN', projectId: 'prj_123', fetch: fetchImpl });
  assert.equal(port.configured, true);
  assert.deepEqual(await port.addDomain(HOST), { ok: true });
  assert.equal(seen[0]!.method, 'POST');
  assert.equal(seen[0]!.url, 'https://api.vercel.com/v10/projects/prj_123/domains');
  assert.equal(seen[0]!.headers.authorization, 'Bearer SECRET-TOKEN');
  assert.deepEqual(JSON.parse(seen[0]!.body ?? '{}'), { name: HOST });
  assert.equal(seen[0]!.url.includes('SECRET'), false);
  assert.equal((seen[0]!.body ?? '').includes('SECRET'), false);
});

test('vercel: a domain already on this project is success; another Vercel error keeps its code; an unknown one keeps its status', async () => {
  const same = createVercelDomains({ token: 't', projectId: 'p', fetch: fakeFetch(() => jsonResponse(409, { error: { code: 'domain_already_in_this_project' } })).fetchImpl });
  assert.deepEqual(await same.addDomain(HOST), { ok: true });
  const other = createVercelDomains({ token: 't', projectId: 'p', fetch: fakeFetch(() => jsonResponse(409, { error: { code: 'domain_already_in_use' } })).fetchImpl });
  assert.deepEqual(await other.addDomain(HOST), { ok: false, reason: 'domain_already_in_use' });
  const bare = createVercelDomains({ token: 't', projectId: 'p', fetch: fakeFetch(() => new Response('oops', { status: 500 })).fetchImpl });
  assert.deepEqual(await bare.addDomain(HOST), { ok: false, reason: 'vercel_http_500' });
});

test('vercel: a network failure and a timeout answer a reason and never throw or leak the token', async () => {
  const down = createVercelDomains({ token: 'SECRET-TOKEN', projectId: 'p', fetch: fakeFetch(() => new Error('connect ECONNREFUSED SECRET-TOKEN')).fetchImpl });
  const result = await down.addDomain(HOST);
  assert.deepEqual(result, { ok: false, reason: 'vercel_unreachable' });
  const slowErr = Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' });
  const slow = createVercelDomains({ token: 't', projectId: 'p', fetch: fakeFetch(() => slowErr).fetchImpl });
  assert.deepEqual(await slow.removeDomain(HOST), { ok: false, reason: 'vercel_timeout' });
});

test('vercel: remove deletes the host from the project; a host that is not there (404) is success', async () => {
  const { seen, fetchImpl } = fakeFetch((_url, method) => (method === 'DELETE' ? jsonResponse(404, { error: { code: 'not_found' } }) : jsonResponse(200, {})));
  const port = createVercelDomains({ token: 't', projectId: 'prj 1', fetch: fetchImpl });
  assert.deepEqual(await port.removeDomain(HOST), { ok: true });
  assert.equal(seen[0]!.method, 'DELETE');
  assert.equal(seen[0]!.url, 'https://api.vercel.com/v9/projects/prj%201/domains/' + HOST);
  const refused = createVercelDomains({ token: 't', projectId: 'p', fetch: fakeFetch(() => jsonResponse(403, { error: { code: 'forbidden' } })).fetchImpl });
  assert.deepEqual(await refused.removeDomain(HOST), { ok: false, reason: 'forbidden' });
});

test('vercel: the stub records and succeeds, and it is what the environment gives unless BOTH settings are set', async () => {
  const stub = createStubVercelDomains();
  assert.equal(stub.configured, false);
  assert.deepEqual(await stub.addDomain(HOST), { ok: true });
  assert.deepEqual(await stub.removeDomain(HOST), { ok: true });
  assert.deepEqual(stub.calls, [{ op: 'add', host: HOST }, { op: 'remove', host: HOST }]);
  assert.equal(getVercelDomains({}).configured, false);
  assert.equal(getVercelDomains({ VERCEL_PROJECT_ID: 'p' }).configured, false);
  assert.equal(getVercelDomains({ VERCEL_API_TOKEN: ' ', VERCEL_PROJECT_ID: 'p' }).configured, false);
  assert.equal(getVercelDomains({ VERCEL_API_TOKEN: 't', VERCEL_PROJECT_ID: 'p' }).configured, true);
});
