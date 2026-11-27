import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base32Decode, base32Encode, hashRecoveryCode, hotp, matchTotpStep, newRecoveryCodes, newTotpSecret, openSecret, sealSecret, totpStep } from '../src/totp';
import { APP_STORE_URLS, UpgradeRequiredError, assertAppVersion, createMinVersionReader, parseAppVersion } from '../src/mobile-version';

// Sprint 9 (EP-31.US01.T07, T08).

// RFC 6238, appendix B, SHA-1: the secret is the ASCII text below; the values are the last six digits of the RFC's eight.
const RFC_SECRET = Buffer.from('12345678901234567890');
const RFC_VECTORS: Array<[number, string]> = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

test('TOTP matches the RFC 6238 test values', () => {
  for (const [seconds, value] of RFC_VECTORS) {
    assert.equal(hotp(RFC_SECRET, totpStep(seconds * 1000), 8), value, String(seconds));
    assert.equal(hotp(RFC_SECRET, totpStep(seconds * 1000)), value.slice(2));
  }
});

test('a code is accepted for the current step and one either way, once, and never two steps away', () => {
  const secret = base32Encode(RFC_SECRET);
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepEqual(base32Decode(secret), RFC_SECRET);
  const now = 1111111111 * 1000;
  const step = totpStep(now);
  for (const offset of [-1, 0, 1]) assert.equal(matchTotpStep(secret, hotp(RFC_SECRET, step + offset), now), step + offset);
  for (const offset of [-2, 2]) assert.equal(matchTotpStep(secret, hotp(RFC_SECRET, step + offset), now), null);
  assert.equal(matchTotpStep(secret, hotp(RFC_SECRET, step), now, step), null, 'already used');
  assert.equal(matchTotpStep(secret, hotp(RFC_SECRET, step + 1), now, step), step + 1);
  for (const bad of [undefined, 123456, '12345', '1234567', 'abcdef']) assert.equal(matchTotpStep(secret, bad, now), null);
  assert.match(newTotpSecret(), /^[A-Z2-7]{32}$/);
});

test('a sealed secret opens only with the same key and only unchanged', () => {
  const sealed = sealSecret('GEZDGNBVGY3TQOJQ', 'k'.repeat(40));
  assert.equal(sealed.includes('GEZDGNBVGY3TQOJQ'), false);
  assert.notEqual(sealed, sealSecret('GEZDGNBVGY3TQOJQ', 'k'.repeat(40)), 'a fresh nonce each time');
  assert.equal(openSecret(sealed, 'k'.repeat(40)), 'GEZDGNBVGY3TQOJQ');
  assert.equal(openSecret(sealed, 'z'.repeat(40)), null);
  assert.equal(openSecret(sealed.slice(0, -2) + 'AA', 'k'.repeat(40)), null);
  assert.equal(openSecret('garbage', 'k'.repeat(40)), null);
});

test('recovery codes: ten different ones, hashed without their dashes or case', () => {
  const { codes, hashes } = newRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const [i, code] of codes.entries()) {
    assert.match(code, /^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    assert.equal(hashRecoveryCode(code.toLowerCase().replace(/-/g, '')), hashes[i]);
    assert.match(hashes[i]!, /^[0-9a-f]{64}$/);
  }
});

test('the version gate: no minimum lets everybody in; a minimum refuses an older, a missing or an unreadable version', () => {
  const headers = (version?: string) => new Headers(version === undefined ? {} : { 'x-app-version': version });
  for (const none of [null, undefined, '', 'soon']) assertAppVersion(headers(), 'seller', none);
  for (const fine of ['1.4.0', '1.4', '1.4.1', '2.0', '1.10.0', '1.4.0-beta']) assertAppVersion(headers(fine), 'seller', '1.4.0');
  for (const old of [undefined, '', '1.3.9', '1', '0.9', 'v1.4.0']) {
    assert.throws(() => assertAppVersion(headers(old), 'admin', '1.4.0'), (err: unknown) => err instanceof UpgradeRequiredError && err.minVersion === '1.4.0' && err.storeUrl === APP_STORE_URLS.admin, String(old));
  }
  assert.deepEqual(parseAppVersion('10.2.3+45'), [10, 2, 3]);
});

test('the minimum is cached for a short while, and a failed read lets the request through', async () => {
  let reads = 0;
  let value: string | null = '1.0.0';
  const reader = createMinVersionReader(async () => ((reads += 1), value), 1000);
  assert.equal(await reader.read(0), '1.0.0');
  value = '2.0.0';
  assert.equal(await reader.read(500), '1.0.0');
  assert.equal(await reader.read(1500), '2.0.0');
  assert.equal(reads, 2);
  const saved = console.error;
  console.error = () => {};
  try {
    assert.equal(await createMinVersionReader(async () => Promise.reject(new Error('down'))).read(), null);
  } finally {
    console.error = saved;
  }
});
