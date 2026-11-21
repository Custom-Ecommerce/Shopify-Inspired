import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchOrderPhone, phoneKeyOf, samePhone } from '@/lib/storefront/order-phone';
import { normalizePhoneE164 } from '@/lib/contracts';

// Sprint 5 EP-10.US01 (D-108): the one shared phone comparison and the key an order is stored under. The rule is the existing
// normalizePhoneE164; these helpers only replace the two private samePhone copies of the lookup and track routes.

test('samePhone is an exact comparison of two E.164 strings', () => {
  assert.equal(samePhone('+923001234567', '+923001234567'), true);
  assert.equal(samePhone('+923001234567', '+923001234568'), false);
  assert.equal(samePhone('+923001234567', '+92300123456'), false, 'a different length is simply false, never a throw');
  assert.equal(samePhone('', ''), true);
});

test('matchOrderPhone: an older order with a local phone format still matches the number the shopper typed, and returns the normalised phone', () => {
  const given = '+923001234567';
  for (const stored of ['+923001234567', '03001234567', '0300-1234567', '3001234567', '00923001234567', ' +92 300 1234567 ']) {
    assert.equal(matchOrderPhone(stored, given), given, stored);
  }
});

test('matchOrderPhone: another number, a missing phone or a value that is not a phone never matches', () => {
  const given = '+923001234567';
  for (const stored of ['+923007654321', '03007654321', '', null, undefined, 12345, 'not a phone', '+441234567890']) {
    assert.equal(matchOrderPhone(stored, given), null, String(stored));
  }
});

test('phoneKeyOf is normalizePhoneE164, with undefined (the field stays absent) when there is no mobile number', () => {
  assert.equal(phoneKeyOf('0300 1234567'), '+923001234567');
  assert.equal(phoneKeyOf('+923001234567'), '+923001234567');
  for (const bad of ['', '   ', 'abc', '0300', null, undefined, 42]) assert.equal(phoneKeyOf(bad), undefined, String(bad));
  for (const sample of ['03001234567', '3001234567', '+92 0300 1234567', 'x']) assert.equal(phoneKeyOf(sample) ?? null, normalizePhoneE164(sample), 'the same rule, not a copy: ' + sample);
});
