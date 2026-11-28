import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { OWNER_ONLY_CAPABILITIES, SELLER_CAPABILITIES, SELLER_ROLES, sellerCan } from '@/lib/services';
import {
  ROUTE_CAPABILITIES,
  isCapabilityAccess,
  roleMayCall,
  rolesForRoute,
  routeEntries,
  type RouteAccess,
} from '../src/lib/route-capabilities';

// Sprint 8 (S8-B3, D-118): the guard of the seller backend, the twin of the admin authorizeAdmin guard. It reads EVERY route file and fails when a route has no entry in the capability
// map (src/lib/route-capabilities.ts), when an entry has no route, or when the route does not call the resolver with the mapped capability. A NEW route file nobody mapped fails here.

const API = join(process.cwd(), 'src', 'app', 'api');

interface RouteMethod {
  key: string;
  path: string;
  method: string;
  file: string;
  /** The text of this method: from its `export` to the next method (or the end of the file). */
  segment: string;
  whole: string;
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === 'route.ts' ? [full] : [];
  });
}

function readRoutes(): RouteMethod[] {
  const out: RouteMethod[] = [];
  for (const file of routeFiles(API)) {
    const path = relative(API, join(file, '..')).split(sep).join('/');
    const whole = readFileSync(file, 'utf8');
    const starts = [...whole.matchAll(/export (?:async )?function (GET|POST|PATCH|PUT|DELETE)\b/g)].map((m) => ({ method: m[1]!, at: m.index! }));
    starts.forEach((start, index) => {
      const end = index + 1 < starts.length ? starts[index + 1]!.at : whole.length;
      out.push({ key: path + ' ' + start.method, path, method: start.method, file, segment: whole.slice(start.at, end), whole });
    });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

const ROUTES = readRoutes();
const RESOLVERS = [
  'resolveOwnedStoreId(',
  'resolveStoreAccess(',
  'loadOwnedStore(',
  'loadStoreFor(',
  'resolveCategoryStoreId(',
  'changePublished(',
  'restoreProduct(',
  'prepareReturnRoute(',
  'prepareReturnRouteNoBody(',
  'saveReply(',
  'prepareTeamRoute',
];

/** The routes whose capability depends on the body: the literal of the floor (or the function that derives it) must be in the method. */
const DYNAMIC: Readonly<Record<string, string>> = { 'stores/[id] PATCH': 'settingsGroupCapabilities(' };

test('the guard finds the routes: more than a hundred route files and well over two hundred methods', () => {
  assert.ok(routeFiles(API).length > 150, String(routeFiles(API).length));
  assert.ok(ROUTES.length > 200, String(ROUTES.length));
});

test('EVERY route method has an entry in the capability map, and every entry has a route: a new route nobody mapped fails here', () => {
  const unmapped = ROUTES.filter((route) => !(route.key in ROUTE_CAPABILITIES)).map((route) => route.key);
  assert.deepEqual(unmapped, [], 'routes with no entry in src/lib/route-capabilities.ts: ' + unmapped.join(', '));
  const real = new Set(ROUTES.map((route) => route.key));
  const stale = Object.keys(ROUTE_CAPABILITIES).filter((key) => !real.has(key));
  assert.deepEqual(stale, [], 'entries of the map with no route: ' + stale.join(', '));
});

test('every entry is a known capability or one of account, public, system, owner-only', () => {
  for (const [key, access] of routeEntries()) {
    assert.ok(isCapabilityAccess(access) ? (SELLER_CAPABILITIES as readonly string[]).includes(access) : ['account', 'public', 'system', 'owner-only'].includes(access), key + ' -> ' + access);
  }
});

test('a route that serves a store passes its mapped capability to the resolver (the literal is in the method, next to a resolver call)', () => {
  const failures: string[] = [];
  for (const route of ROUTES) {
    const access = ROUTE_CAPABILITIES[route.key] as RouteAccess;
    if (!isCapabilityAccess(access)) continue;
    const dynamic = DYNAMIC[route.key];
    const literal = dynamic === undefined ? "'" + access + "'" : dynamic;
    if (!route.segment.includes(literal)) failures.push(route.key + ': the method does not contain ' + literal);
    if (!RESOLVERS.some((resolver) => route.segment.includes(resolver))) failures.push(route.key + ': the method calls no resolver');
  }
  assert.deepEqual(failures, []);
});

test('a route that serves a store NEVER calls a resolver without a capability (that would be owner-only by accident)', () => {
  const failures: string[] = [];
  const known = SELLER_CAPABILITIES as readonly string[];
  for (const route of ROUTES) {
    const access = ROUTE_CAPABILITIES[route.key] as RouteAccess;
    if (!isCapabilityAccess(access)) continue;
    for (const match of route.segment.matchAll(/resolveOwnedStoreId\(([^)]*)\)/g)) {
      if (!/capability/.test(match[1]!)) failures.push(route.key + ': ' + match[0]);
    }
    for (const match of route.segment.matchAll(/loadOwnedStore\(([^()]*)\)/g)) {
      const last = [...match[1]!.matchAll(/'([a-z_.]+)'/g)].at(-1)?.[1] ?? '';
      if (!known.includes(last)) failures.push(route.key + ': ' + match[0]);
    }
    for (const match of route.segment.matchAll(/resolveCategoryStoreId\(([^()]*)\)/g)) {
      const last = [...match[1]!.matchAll(/'([a-z_.]+)'/g)].at(-1)?.[1] ?? '';
      if (!known.includes(last)) failures.push(route.key + ': ' + match[0]);
    }
  }
  assert.deepEqual(failures, []);
});

test('account routes need a signed-in user; public and system routes never read a seller session or resolve a store', () => {
  const failures: string[] = [];
  for (const route of ROUTES) {
    const access = ROUTE_CAPABILITIES[route.key] as RouteAccess;
    if (access === 'account' && !/authenticate\(|requireSeller|requireBillingCaller/.test(route.segment)) failures.push(route.key + ': an account route that checks no session');
    if ((access === 'public' || access === 'system') && /resolveOwnedStoreId\(|loadOwnedStore\(|resolveStoreAccess\(|loadStoreFor\(/.test(route.segment)) failures.push(route.key + ': a ' + access + ' route that resolves a seller store');
    if (access === 'system' && /\bauthenticate\(/.test(route.segment)) failures.push(route.key + ': a system route that reads a seller session');
  }
  assert.deepEqual(failures, []);
});

test('the storefront API is public, the internal API is system, and nothing else is: a seller route cannot hide under either prefix', () => {
  for (const route of ROUTES) {
    const access = ROUTE_CAPABILITIES[route.key];
    if (route.path.startsWith('storefront/')) assert.equal(access, 'public', route.key);
    else if (route.path.startsWith('internal/')) assert.equal(access, 'system', route.key);
    else if (route.path.startsWith('v1/')) assert.equal(access, 'public', route.key);
    else {
      assert.notEqual(access, 'system', route.key);
      if (access === 'public') assert.ok(['auth/forgot-password', 'auth/reset-password', 'auth/verify-email', 'health', 'signup', 'unsubscribe', 'users/login', 'webhooks/stripe-orders', 'team/invite', 'mobile/v1/auth/login', 'mobile/v1/auth/refresh', 'mobile/v1/auth/logout'].includes(route.path), route.key);
    }
  }
});

test('the owner-only routes: earnings, commission, domain, go-live, billing and plan usage, the team: the owner alone, every staff role refused', () => {
  const ownerOnlyRoutes = ROUTES.filter((route) => {
    const access = ROUTE_CAPABILITIES[route.key] as RouteAccess;
    return isCapabilityAccess(access) && (OWNER_ONLY_CAPABILITIES as readonly string[]).includes(access);
  });
  const paths = new Set(ownerOnlyRoutes.map((route) => route.path));
  for (const expected of [
    'stores/[id]/earnings',
    'stores/[id]/commission',
    'stores/[id]/domain',
    'stores/[id]/domain/connect',
    'stores/[id]/domain/disconnect',
    'stores/[id]/domain/verify',
    'stores/[id]/go-live',
    'stores/[id]/plan-usage',
    'stores/[id]/api-keys',
    'stores/[id]/api-keys/[keyId]/revoke',
    'stores/[id]/team',
    'stores/[id]/team/invite',
    'stores/[id]/team/[memberId]',
    'stores/[id]/team/[memberId]/resend',
    'stores/[id]/team/[memberId]/disable',
    'stores/[id]/team/[memberId]/enable',
    'stores/[id]/team/[memberId]/remove',
  ]) {
    assert.ok(paths.has(expected), expected + ' is owner-only');
  }
  for (const route of ownerOnlyRoutes) assert.deepEqual(rolesForRoute(route.key), ['owner'], route.key);
  assert.equal(ROUTE_CAPABILITIES['billing/checkout POST'], 'owner-only');
});

test('the public API v1 (S8-B5): GET only, every route goes through the API key check, none reads a session, a cookie or x-store-id', () => {
  const v1 = ROUTES.filter((route) => route.path.startsWith('v1/'));
  assert.deepEqual(v1.map((route) => route.key).sort(), ['v1/orders GET', 'v1/orders/[id] GET', 'v1/products GET', 'v1/products/[id] GET']);
  for (const route of v1) {
    assert.match(route.segment, /v1Read\(request, '(products|orders):read'/, route.key);
    assert.doesNotMatch(route.whole, /authenticate\(|cookies|x-store-id|resolveOwnedStoreId|resolveStoreAccess/, route.key);
    assert.doesNotMatch(route.whole, /export (const|async function|function) (POST|PUT|PATCH|DELETE)\b/, route.key + ': an unexported method is answered 405 by Next');
  }
  for (const file of ['api-v1.ts', 'api-v1-read.ts']) {
    const source = readFileSync(join(process.cwd(), 'src', 'lib', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(source, /authenticate\(|cookies|x-store-id|resolveOwnedStoreId|resolveStoreAccess/, file);
  }
});

// ---------------------------------------------------------------------------------------------------- per-role tables, generated from the map

test('the per-role table, generated from the map: a role may call a route exactly when the matrix gives it the route capability', () => {
  const rows: string[] = [];
  for (const [key, access] of routeEntries()) {
    for (const role of SELLER_ROLES) {
      const expected = isCapabilityAccess(access) && sellerCan(role, access);
      assert.equal(roleMayCall(role, key), expected, role + ' ' + key);
      if (expected) rows.push(role + ' ' + key);
    }
  }
  assert.ok(rows.length > 200);
});

test('the owner may call every route that serves a store (unaffected by the staff model)', () => {
  const storeRoutes = routeEntries().filter(([, access]) => isCapabilityAccess(access));
  assert.ok(storeRoutes.length > 90);
  for (const [key] of storeRoutes) assert.ok(roleMayCall('owner', key), key);
});

test('a role that is not in the matrix, and a route that is not in the map, are denied', () => {
  assert.equal(roleMayCall('admin' as never, 'orders GET'), false);
  assert.equal(roleMayCall(undefined as never, 'orders GET'), false);
  assert.equal(roleMayCall('owner', 'no/such/route GET'), false);
  assert.equal(roleMayCall('owner', 'workspace GET'), false, 'an account route is not one a member reaches through the store roles');
});

const may = (role: (typeof SELLER_ROLES)[number], key: string): boolean => roleMayCall(role, key);

test('staff: orders, products, inventory (and what products need); not customers, customer export, return refunds, reviews, settings, money', () => {
  for (const key of ['orders GET', 'orders/[id] GET', 'orders/[id]/transition POST', 'orders/[id]/cancel POST', 'orders/[id]/tracking POST', 'orders/[id]/payment POST', 'orders/[id]/notes POST', 'orders/print GET', 'products GET', 'products POST', 'products/[id] PATCH', 'products/[id]/publish POST', 'products/import POST', 'products/export GET', 'categories POST', 'media POST', 'inventory GET', 'inventory/adjust POST', 'inventory/history GET', 'alerts GET']) {
    assert.equal(may('staff', key), true, key);
  }
  for (const key of ['stores/[id]/customers GET', 'stores/[id]/customers/[key] GET', 'stores/[id]/customers/export GET', 'stores/[id]/customers/[key]/note PATCH', 'stores/[id]/returns GET', 'returns GET', 'stores/[id]/returns/[returnId]/approve POST', 'stores/[id]/returns/[returnId]/refund POST', 'reviews GET', 'reviews/[id]/reply POST', 'contactMessages GET', 'discounts GET', 'analytics GET', 'stores/[id] PATCH', 'stores/[id]/readiness GET', 'stores/[id]/earnings GET', 'stores/[id]/commission GET', 'stores/[id]/team GET', 'stores/[id]/blocklist GET', 'stores/[id]/broadcast GET', 'storePages GET', 'storeArticles GET']) {
    assert.equal(may('staff', key), false, key);
  }
  assert.equal(may('staff', 'stores/[id]/settings GET'), true, 'every role may read the safe subset of the settings (store.view)');
});

test('support: orders (view and notes, not the order itself), returns (mark, never refund), customers (view and notes, never export), reviews reply, contact inbox; not products, inventory, settings, money', () => {
  for (const key of ['orders GET', 'orders/[id] GET', 'orders/print GET', 'orders/[id]/notes POST', 'stores/[id]/returns GET', 'returns/[id] GET', 'stores/[id]/returns/[returnId]/approve POST', 'stores/[id]/returns/[returnId]/receive POST', 'stores/[id]/returns/[returnId]/reject POST', 'stores/[id]/customers GET', 'stores/[id]/customers/[key] GET', 'stores/[id]/customers/[key]/note PATCH', 'reviews GET', 'reviews/[id]/reply POST', 'contactMessages GET', 'contactMessages/[id] PATCH', 'contactMessages/[id]/reply POST', 'alerts GET']) {
    assert.equal(may('support', key), true, key);
  }
  for (const key of ['orders/[id]/transition POST', 'orders/[id]/cancel POST', 'orders/[id]/tracking POST', 'orders/[id]/payment POST', 'stores/[id]/orders/[orderId]/confirmation POST', 'stores/[id]/returns/[returnId]/refund POST', 'stores/[id]/customers/export GET', 'products GET', 'products POST', 'inventory GET', 'inventory/adjust POST', 'categories GET', 'media GET', 'stores/[id] PATCH', 'stores/[id]/readiness GET', 'stores/[id]/earnings GET', 'stores/[id]/commission GET', 'stores/[id]/domain GET', 'stores/[id]/team GET', 'discounts GET', 'analytics GET', 'stores/[id]/blocklist GET']) {
    assert.equal(may('support', key), false, key);
  }
});

test('manager: everything except the owner-only list, and the refund and the customer export are the manager\'s', () => {
  for (const [key, access] of routeEntries()) {
    if (!isCapabilityAccess(access)) continue;
    const ownerOnly = (OWNER_ONLY_CAPABILITIES as readonly string[]).includes(access);
    assert.equal(may('manager', key), !ownerOnly, key);
  }
  assert.equal(may('manager', 'stores/[id]/returns/[returnId]/refund POST'), true);
  assert.equal(may('manager', 'stores/[id]/customers/export GET'), true);
});

test('the matrix holds the sweep: the capabilities of the map all exist, and the owner-only capabilities are used by owner-only routes only', () => {
  const used = new Set(routeEntries().map(([, access]) => access));
  for (const capability of OWNER_ONLY_CAPABILITIES) {
    if (!used.has(capability)) continue;
    for (const [key, access] of routeEntries()) if (access === capability) assert.deepEqual(rolesForRoute(key), ['owner'], key);
  }
  assert.ok(used.has('settings.domain') && used.has('go_live') && used.has('earnings.read') && used.has('commission.read') && used.has('team.manage') && used.has('billing.manage'));
});
