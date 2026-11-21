import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCKLIST_MAX,
  CONFIRMATION_NOTE_MAX,
  CONTACT_BLOCKED_MESSAGE,
  RISK_FLAGS,
  assessOrderRisk,
  blockedContactRequestSchema,
  normalizeBlockValue,
  orderConfirmationRequestSchema,
  readConfirmationStatus,
  readRiskFlags,
  type RiskInput,
} from '../src/fraud';
import { DEFAULT_FRAUD_SETTINGS, storeFraudUpdateSchema, storeSettingsUpdateSchema } from '../src/store-settings';
import { failingPaths } from './helpers';

// Sprint 5 EP-11 (D-107): the risk rules, the confirmation decision, the blocklist and the 'fraud' settings group. Pure, no database.

const RULES = { flagOrderValueAbove: 15000, flaggedCities: ['Karachi', 'Quetta'], flagReturnsAtLeast: 2 };
const BASE: RiskInput = {
  mode: 'flagged',
  rules: RULES,
  paymentMethod: 'cod',
  total: 5000,
  city: 'Lahore',
  returnsCount: 0,
  hasEarlierOrder: true,
};
const assess = (over: Partial<RiskInput> = {}) => assessOrderRisk({ ...BASE, ...over });

// ------------------------------------------------------------------------------------------------------------------ modes

test('mode off: no flags and no confirmation, whatever the rules and the order say', () => {
  const result = assess({ mode: 'off', total: 99999, city: 'Karachi', returnsCount: 9, hasEarlierOrder: false });
  assert.deepEqual(result, { riskFlags: [], confirmationStatus: 'not_required' });
});

test('mode flagged: an order with no flag is not_required; high_value, flagged_city or repeat_returns make it unconfirmed', () => {
  assert.deepEqual(assess(), { riskFlags: [], confirmationStatus: 'not_required' });
  for (const over of [{ total: 15001 }, { city: 'Karachi' }, { returnsCount: 2 }]) {
    assert.equal(assess(over).confirmationStatus, 'unconfirmed', JSON.stringify(over));
    assert.equal(assess(over).riskFlags.length, 1, JSON.stringify(over));
  }
});

test('D-109: new_customer is a chip only: it never makes an order unconfirmed by itself, in any mode', () => {
  const first = assess({ hasEarlierOrder: false });
  assert.deepEqual(first.riskFlags, ['new_customer']);
  assert.equal(first.confirmationStatus, 'not_required');
  // Together with a rule that does count, the order is unconfirmed and keeps both flags.
  const both = assess({ hasEarlierOrder: false, total: 15001 });
  assert.deepEqual(both.riskFlags, ['high_value', 'new_customer']);
  assert.equal(both.confirmationStatus, 'unconfirmed');
  // Mode all confirms every COD order whatever the flags; mode off stores none.
  assert.equal(assess({ mode: 'all', hasEarlierOrder: false }).confirmationStatus, 'unconfirmed');
  assert.deepEqual(assess({ mode: 'off', hasEarlierOrder: false }), { riskFlags: [], confirmationStatus: 'not_required' });
  // A card order is never unconfirmed.
  assert.equal(assess({ paymentMethod: 'card', hasEarlierOrder: false, total: 99999 }).confirmationStatus, 'not_required');
});

test('mode all: every COD order is unconfirmed, flagged or not; a card order never is', () => {
  assert.equal(assess({ mode: 'all' }).confirmationStatus, 'unconfirmed');
  assert.deepEqual(assess({ mode: 'all' }).riskFlags, []);
  assert.equal(assess({ mode: 'all', total: 99999 }).confirmationStatus, 'unconfirmed');
  for (const mode of ['flagged', 'all'] as const) {
    const card = assess({ mode, paymentMethod: 'card', total: 99999, hasEarlierOrder: false });
    assert.equal(card.confirmationStatus, 'not_required', mode + ' card');
    assert.ok(card.riskFlags.includes('high_value'), 'the card order still carries its flags');
  }
  assert.equal(assess({ mode: 'all', paymentMethod: undefined }).confirmationStatus, 'not_required', 'an unknown payment method is not COD');
});

// ----------------------------------------------------------------------------------------------------------------- rules

test('high_value: strictly above the amount (the amount itself is not flagged); no rule, no flag', () => {
  assert.deepEqual(assess({ total: 15000 }).riskFlags, []);
  assert.deepEqual(assess({ total: 15001 }).riskFlags, ['high_value']);
  assert.deepEqual(assess({ total: 1_000_000, rules: { ...RULES, flagOrderValueAbove: null } }).riskFlags, []);
});

test('flagged_city: matched with the shared city matcher, so case, spaces and dots do not matter; other cities and no city are not flagged', () => {
  for (const city of ['Karachi', 'karachi', ' KARACHI ', 'Quetta']) assert.deepEqual(assess({ city }).riskFlags, ['flagged_city'], city);
  assert.deepEqual(assess({ rules: { ...RULES, flaggedCities: ['Rahim Yar Khan'] }, city: 'rahim  yar khan' }).riskFlags, ['flagged_city']);
  for (const city of ['Lahore', 'Karachi Cantt', '', null, undefined]) assert.deepEqual(assess({ city }).riskFlags, [], String(city));
  assert.deepEqual(assess({ city: 'Karachi', rules: { ...RULES, flaggedCities: [] } }).riskFlags, []);
});

test('repeat_returns: at or above the count; a customer with no returns is never flagged, and a rule of null is off', () => {
  assert.deepEqual(assess({ returnsCount: 1 }).riskFlags, []);
  assert.deepEqual(assess({ returnsCount: 2 }).riskFlags, ['repeat_returns']);
  assert.deepEqual(assess({ returnsCount: 7 }).riskFlags, ['repeat_returns']);
  assert.deepEqual(assess({ returnsCount: 7, rules: { ...RULES, flagReturnsAtLeast: null } }).riskFlags, []);
  // The returns count reads 0 until EP-13 (SB-3): nobody is flagged by this rule yet.
  assert.deepEqual(assess({ returnsCount: 0 }).riskFlags, []);
});

test('new_customer: no earlier order with the same phone key', () => {
  assert.deepEqual(assess({ hasEarlierOrder: false }).riskFlags, ['new_customer']);
  assert.deepEqual(assess({ hasEarlierOrder: true }).riskFlags, []);
});

test('several rules together: every flag is listed, in the fixed order, and the order is still not rejected', () => {
  const result = assess({ total: 20000, city: 'Quetta', returnsCount: 3, hasEarlierOrder: false });
  assert.deepEqual(result.riskFlags, ['high_value', 'flagged_city', 'repeat_returns', 'new_customer']);
  assert.deepEqual([...RISK_FLAGS], result.riskFlags);
  assert.equal(result.confirmationStatus, 'unconfirmed');
  // The result carries a status and flags only: there is no way to express a rejection.
  assert.deepEqual(Object.keys(result).sort(), ['confirmationStatus', 'riskFlags']);
});

test('reading what is stored: an unknown status reads as not_required, unknown flags are dropped, duplicates collapse', () => {
  assert.equal(readConfirmationStatus(undefined), 'not_required');
  assert.equal(readConfirmationStatus('banana'), 'not_required');
  for (const status of ['not_required', 'unconfirmed', 'confirmed', 'unreachable']) assert.equal(readConfirmationStatus(status), status);
  assert.deepEqual(readRiskFlags(undefined), []);
  assert.deepEqual(readRiskFlags(['new_customer', 'banana', 'high_value', 'high_value']), ['high_value', 'new_customer']);
});

// ----------------------------------------------------------------------------------------------------------- the decision

test('the confirmation request: confirmed, unreachable or cancel, a plain note of up to 200 characters, nothing else', () => {
  for (const result of ['confirmed', 'unreachable', 'cancel']) {
    assert.deepEqual(orderConfirmationRequestSchema.parse({ result }), { result, note: null });
  }
  assert.deepEqual(orderConfirmationRequestSchema.parse({ result: 'confirmed', note: '  rang twice\n then picked up ' }), { result: 'confirmed', note: 'rang twice then picked up' });
  assert.deepEqual(orderConfirmationRequestSchema.parse({ result: 'confirmed', note: '   ' }), { result: 'confirmed', note: null });
  assert.equal(orderConfirmationRequestSchema.safeParse({ result: 'confirmed', note: 'x'.repeat(CONFIRMATION_NOTE_MAX) }).success, true);
  const bad: Array<[unknown, string]> = [
    [{}, 'result'],
    [{ result: 'cancelled' }, 'result'],
    [{ result: 'Confirmed' }, 'result'],
    [{ result: 'confirmed', note: 'x'.repeat(CONFIRMATION_NOTE_MAX + 1) }, 'note'],
    [{ result: 'confirmed', note: '<b>x</b>' }, 'note'],
    [{ result: 'confirmed', note: 5 }, 'note'],
  ];
  for (const [value, field] of bad) assert.deepEqual(failingPaths(orderConfirmationRequestSchema.safeParse(value)).slice(0, 1), [field], JSON.stringify(value));
  // Unknown fields are refused, so a body cannot write the status or the log itself.
  for (const extra of ['confirmationStatus', 'confirmationLog', 'status', 'store']) {
    assert.equal(orderConfirmationRequestSchema.safeParse({ result: 'confirmed', [extra]: 'x' }).success, false, extra);
  }
});

// ---------------------------------------------------------------------------------------------------------- blocklist

test('blocked values: a phone is stored as +923xxxxxxxxx in any spelling, an email in lower case; anything else is not a contact', () => {
  for (const spelling of ['03001234567', '0300-1234567', '+92 300 1234567', '923001234567', '00923001234567']) {
    assert.equal(normalizeBlockValue('phone', spelling), '+923001234567', spelling);
  }
  assert.equal(normalizeBlockValue('email', '  Fraud@Example.PK '), 'fraud@example.pk');
  for (const bad of ['', '12345', 'abc', '+441234567890', 5, null]) assert.equal(normalizeBlockValue('phone', bad), null, String(bad));
  for (const bad of ['', 'abc', 'a@b', 'a b@c.pk', '<x>@c.pk', 'x'.repeat(250) + '@c.pk', 5, null]) assert.equal(normalizeBlockValue('email', bad), null, String(bad));
  // A phone is not accepted as an email and the other way round.
  assert.equal(normalizeBlockValue('email', '03001234567'), null);
  assert.equal(normalizeBlockValue('phone', 'a@b.pk'), null);
});

test('the blocklist request: strict, normalizes the value, a reason up to 100 characters; the error names the field', () => {
  assert.deepEqual(blockedContactRequestSchema.parse({ kind: 'phone', value: '0300 1234567', reason: ' Fake  orders ' }), { kind: 'phone', value: '+923001234567', reason: 'Fake orders' });
  assert.deepEqual(blockedContactRequestSchema.parse({ kind: 'email', value: 'A@B.PK' }), { kind: 'email', value: 'a@b.pk', reason: '' });
  assert.equal(blockedContactRequestSchema.safeParse({ kind: 'phone', value: '03001234567', reason: 'x'.repeat(100) }).success, true);
  const bad: Array<[unknown, string]> = [
    [{}, 'kind'],
    [{ kind: 'address', value: 'x' }, 'kind'],
    [{ kind: 'phone', value: 'nope' }, 'value'],
    [{ kind: 'email', value: 'nope' }, 'value'],
    [{ kind: 'phone', value: '03001234567', reason: 'x'.repeat(101) }, 'reason'],
    [{ kind: 'phone', value: '03001234567', reason: '<script>' }, 'reason'],
  ];
  for (const [value, field] of bad) assert.deepEqual(failingPaths(blockedContactRequestSchema.safeParse(value)).slice(0, 1), [field], JSON.stringify(value));
  assert.equal(blockedContactRequestSchema.safeParse({ kind: 'phone', value: '03001234567', store: 'x' }).success, false);
  assert.equal(BLOCKLIST_MAX, 500);
});

test('the sentence a blocked shopper sees never says the contact is blocked', () => {
  assert.equal(CONTACT_BLOCKED_MESSAGE, 'We cannot take this order. Please contact the store.');
  assert.equal(/block|ban|fraud|risk|suspicious/i.test(CONTACT_BLOCKED_MESSAGE), false);
});

// ----------------------------------------------------------------------------------------------------- settings group

test("the 'fraud' group: strict, every field optional, cities matched to the shared list and kept once", () => {
  assert.deepEqual(DEFAULT_FRAUD_SETTINGS, { codConfirmation: 'off', riskRules: { flagOrderValueAbove: null, flaggedCities: [], flagReturnsAtLeast: null } });
  assert.deepEqual(storeFraudUpdateSchema.parse({}), {});
  const parsed = storeFraudUpdateSchema.parse({ codConfirmation: 'all', riskRules: { flagOrderValueAbove: 10000, flaggedCities: ['karachi', 'RAHIM YAR KHAN'], flagReturnsAtLeast: 3 } });
  assert.deepEqual(parsed, { codConfirmation: 'all', riskRules: { flagOrderValueAbove: 10000, flaggedCities: ['Karachi', 'Rahim Yar Khan'], flagReturnsAtLeast: 3 } });
  assert.deepEqual(storeFraudUpdateSchema.parse({ riskRules: { flagOrderValueAbove: null, flagReturnsAtLeast: null } }), { riskRules: { flagOrderValueAbove: null, flagReturnsAtLeast: null } });
});

test("the 'fraud' group: the limits, with the failing field named", () => {
  const bad: Array<[unknown, string]> = [
    [{ codConfirmation: 'sometimes' }, 'codConfirmation'],
    [{ riskRules: { flagOrderValueAbove: 0 } }, 'riskRules.flagOrderValueAbove'],
    [{ riskRules: { flagOrderValueAbove: 1.5 } }, 'riskRules.flagOrderValueAbove'],
    [{ riskRules: { flagOrderValueAbove: 10_000_001 } }, 'riskRules.flagOrderValueAbove'],
    [{ riskRules: { flagReturnsAtLeast: 0 } }, 'riskRules.flagReturnsAtLeast'],
    [{ riskRules: { flagReturnsAtLeast: 11 } }, 'riskRules.flagReturnsAtLeast'],
    [{ riskRules: { flaggedCities: ['Atlantis'] } }, 'riskRules.flaggedCities.0'],
    [{ riskRules: { flaggedCities: ['Karachi', 'karachi'] } }, 'riskRules.flaggedCities'],
    [{ riskRules: { flaggedCities: Array.from({ length: 31 }, () => 'Karachi') } }, 'riskRules.flaggedCities'],
  ];
  for (const [value, field] of bad) assert.deepEqual(failingPaths(storeFraudUpdateSchema.safeParse(value)).slice(0, 1), [field], JSON.stringify(value).slice(0, 80));
  assert.equal(storeFraudUpdateSchema.safeParse({ riskRules: { flagOrderValueAbove: 10_000_000, flagReturnsAtLeast: 10 } }).success, true);
  assert.equal(storeFraudUpdateSchema.safeParse({ banana: 1 }).success, false);
  assert.equal(storeFraudUpdateSchema.safeParse({ riskRules: { banana: 1 } }).success, false);
});

test("the settings update accepts the 'fraud' group like any other group, and still needs at least one group", () => {
  assert.equal(storeSettingsUpdateSchema.safeParse({ fraud: { codConfirmation: 'flagged' } }).success, true);
  assert.equal(storeSettingsUpdateSchema.safeParse({ fraud: { codConfirmation: 'nope' } }).success, false);
  assert.equal(storeSettingsUpdateSchema.safeParse({}).success, false);
});
