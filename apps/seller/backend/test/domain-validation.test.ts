import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalisePlatformHost, platformHostsFromEnv, validateCustomDomain } from '../src/lib/domain-validation';

// S7-B5: what a seller may type as a custom domain. Pure.

const PLATFORM = ['markazify.com', 'localhost'];

const GOOD: Array<[string, string]> = [
  ['shop.zara.pk', 'shop.zara.pk'],
  ['zara.pk', 'zara.pk'],
  ['  Shop.Zara.PK  ', 'shop.zara.pk'],
  ['SHOP.ZARA.PK', 'shop.zara.pk'],
  ['www.zara.com', 'www.zara.com'],
  ['store.my-brand.com.pk', 'store.my-brand.com.pk'],
  ['a.b.c.d.example.org', 'a.b.c.d.example.org'],
  ['my-shop.co', 'my-shop.co'],
  ['shop123.net', 'shop123.net'],
  ['123shop.com', '123shop.com'],
  ['bücher.de', 'xn--bcher-kva.de'],
  ['münchen.example.org', 'xn--mnchen-3ya.example.org'],
  ['xn--bcher-kva.de', 'xn--bcher-kva.de'],
  ['shop.zara.xn--p1ai', 'shop.zara.xn--p1ai'],
  ['markazify.com.evil.pk', 'markazify.com.evil.pk'],
  ['notmarkazify.com', 'notmarkazify.com'],
  ['shop.zara.store', 'shop.zara.store'],
  ['a-b.cc', 'a-b.cc'],
];

const BAD: Array<[string, string]> = [
  ['', 'empty'],
  ['   ', 'empty'],
  ['https://shop.zara.pk/', 'scheme'],
  ['http://shop.zara.pk', 'scheme'],
  ['//shop.zara.pk', 'scheme'],
  ['shop.zara.pk/', 'path'],
  ['shop.zara.pk/store', 'path'],
  ['shop.zara.pk?x=1', 'path'],
  ['shop.zara.pk#top', 'path'],
  ['shop.zara.pk:8080', 'port'],
  ['shop.zara.pk.', 'trailing-dot'],
  ['.shop.zara.pk', 'leading-dot'],
  ['shop zara.pk', 'space'],
  ['user@shop.zara.pk', 'userinfo'],
  ['*.zara.pk', 'wildcard'],
  ['sh*p.zara.pk', 'wildcard'],
  ['127.0.0.1', 'ip'],
  ['10.0.0.1', 'ip'],
  ['192.168.1.20', 'ip'],
  ['8.8.8.8', 'ip'],
  ['[::1]', 'ip'],
  ['::1', 'ip'],
  ['2001:db8::1', 'ip'],
  ['0x7f.0.0.1', 'ip'],
  ['localhost', 'no-dot'],
  ['shop.localhost', 'reserved'],
  ['a.b.localhost', 'reserved'],
  ['printer.local', 'reserved'],
  ['db.internal', 'reserved'],
  ['host.localdomain', 'reserved'],
  ['site.test', 'reserved'],
  ['shop.example', 'reserved'],
  ['router.lan', 'reserved'],
  ['intranet', 'no-dot'],
  ['shop', 'no-dot'],
  ['markazify.com', 'platform'],
  ['www.markazify.com', 'platform'],
  ['zara.markazify.com', 'platform'],
  ['a.b.markazify.com', 'platform'],
  ['MARKAZIFY.COM', 'platform'],
  ['my-shop.vercel.app', 'reserved'],
  ['-shop.zara.pk', 'characters'],
  ['shop-.zara.pk', 'characters'],
  ['sh_op.zara.pk', 'characters'],
  ['sh$op.zara.pk', 'characters'],
  ['zara.p', 'tld'],
  ['zara.123', 'ip'],
  ['zara.c0m', 'tld'],
];

test('a good host is accepted and answered in lower-case punycode', () => {
  assert.ok(GOOD.length >= 18);
  for (const [input, expected] of GOOD) {
    const result = validateCustomDomain(input, PLATFORM);
    assert.equal(result.ok, true, input);
    if (result.ok) assert.equal(result.host, expected, input);
  }
});

test('a bad host is refused with a reason and a plain message (at least 40 of them)', () => {
  assert.ok(BAD.length >= 40, 'table size ' + BAD.length);
  for (const [input, reason] of BAD) {
    const result = validateCustomDomain(input, PLATFORM);
    assert.equal(result.ok, false, input);
    if (!result.ok) {
      assert.equal(result.reason, reason, input);
      assert.ok(result.message.length > 10, input);
    }
  }
});

test('a numeric IP, an empty label and over-long names are refused (whatever the URL parser does with them first)', () => {
  assert.equal(validateCustomDomain('2130706433', PLATFORM).ok, false);
  assert.equal(validateCustomDomain('shop..zara.pk', PLATFORM).ok, false);
  const long = validateCustomDomain('a'.repeat(64) + '.zara.pk', PLATFORM);
  assert.equal(long.ok, false);
  const longest = validateCustomDomain('a.'.repeat(130) + 'pk', PLATFORM);
  assert.equal(longest.ok, false);
  // 63 characters in a label and 253 in all are the edge that still passes.
  assert.equal(validateCustomDomain('a'.repeat(63) + '.zara.pk', PLATFORM).ok, true);
});

test('a pasted URL is refused, never repaired', () => {
  const result = validateCustomDomain('https://shop.zara.pk/', PLATFORM);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /without http/);
});

test('a value that is not a string is refused', () => {
  for (const value of [null, undefined, 42, {}, ['shop.zara.pk']]) assert.equal(validateCustomDomain(value, PLATFORM).ok, false);
});

test('the platform hosts come from ROOT_DOMAIN, PLATFORM_HOSTNAMES and STOREFRONT_URL, port and www removed, and are never hard-coded', () => {
  assert.deepEqual(
    platformHostsFromEnv({ ROOT_DOMAIN: 'Markazify.com:3000', PLATFORM_HOSTNAMES: '127.0.0.1, www.platform.pk', STOREFRONT_URL: 'https://www.shopsite.pk/x' }).sort(),
    ['127.0.0.1', 'markazify.com', 'platform.pk', 'shopsite.pk'],
  );
  assert.deepEqual(platformHostsFromEnv({}), []);
  assert.deepEqual(platformHostsFromEnv({ STOREFRONT_URL: 'not a url' }), []);
  assert.equal(normalisePlatformHost('Localhost:3000'), 'localhost');
  // With another platform host the refusal follows it.
  assert.equal(validateCustomDomain('shop.platform.pk', ['platform.pk']).ok, false);
  assert.equal(validateCustomDomain('markazify.com', ['platform.pk']).ok, true);
});

test('with no environment the default is the environment: a store named like the storefront host is refused', () => {
  const saved = process.env.STOREFRONT_URL;
  process.env.STOREFRONT_URL = 'https://markazify.com';
  try {
    assert.equal(validateCustomDomain('shop.markazify.com').ok, false);
    assert.equal(validateCustomDomain('shop.zara.pk').ok, true);
  } finally {
    if (saved === undefined) delete process.env.STOREFRONT_URL;
    else process.env.STOREFRONT_URL = saved;
  }
});
