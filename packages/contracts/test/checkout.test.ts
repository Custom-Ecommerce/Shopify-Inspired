import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHECKOUT_ADDRESS_MAX,
  CHECKOUT_CITY_MAX,
  CHECKOUT_EMAIL_MAX,
  CHECKOUT_NAME_MAX,
  CHECKOUT_NOTE_MAX,
  normalizePhoneE164,
  storefrontCartQuoteRequestSchema,
  storefrontCartQuoteResponseSchema,
  storefrontCartQuoteSchema,
  storefrontCheckoutCustomerSchema,
  storefrontQuoteTotalsSchema,
} from '../src/checkout';
import * as root from '../src/index';

const STORED = '+923001234567';
const valid = { customerName: 'Sara Khan', phone: '0300 1234567', address: 'House 12, Street 4, Block 5', city: 'Karachi' };

const parse = (overrides: Record<string, unknown>) => storefrontCheckoutCustomerSchema.safeParse({ ...valid, ...overrides });

function refusal(overrides: Record<string, unknown>): { path: string; message: string } {
  const result = parse(overrides);
  assert.equal(result.success, false, JSON.stringify(overrides));
  if (result.success) throw new Error('unreachable');
  return { path: result.error.issues[0]!.path.join('.'), message: result.error.issues[0]!.message };
}

const urdu = (digits: string): string => digits.replace(/\d/g, (d) => String.fromCharCode(0x06f0 + Number(d)));
const arabic = (digits: string): string => digits.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));

/* ------------------------------------------- phone ------------------------------------------- */

for (const phone of [
  '03001234567',
  '0300 1234567',
  '0300-1234567',
  '0300 123 4567',
  '(0300) 1234567',
  '0300.123.4567',
  '  03001234567  ',
  '3001234567',
  '300 1234567',
  '923001234567',
  '92 300 1234567',
  '92-300-1234567',
  '+923001234567',
  '+92 300 1234567',
  '+92-300-1234567',
  '+92 (300) 1234567',
  '00923001234567',
  '0092 300 1234567',
  '+92 0300 1234567',
  '+920300-1234567',
  '92 0300 1234567',
  '0092 0300 1234567',
  '0300 1234567', // no-break space
  '0300–1234567', // en dash
  '0300‑1234567', // non-breaking hyphen
  '‪+92 300 1234567‬', // direction marks from pasted right-to-left text
  '‎03001234567',
]) {
  test('accepted, one stored format: ' + JSON.stringify(phone), () => {
    assert.equal(normalizePhoneE164(phone), STORED);
    const result = parse({ phone });
    assert.equal(result.success, true);
    if (result.success) assert.equal(result.data.phone, STORED);
  });
}

for (const [name, phone] of [
  ['Urdu digits', urdu('03001234567')],
  ['Urdu digits with spaces', urdu('0300 1234567')],
  ['Urdu digits with dashes', urdu('0300-1234567')],
  ['Urdu digits with +92', '+' + urdu('923001234567')],
  ['Urdu digits with 92', urdu('92 300 1234567')],
  ['Urdu digits with +92 and the 0 kept', '+' + urdu('92 0300 1234567')],
  ['Arabic digits', arabic('03001234567')],
  ['Urdu and ASCII digits mixed', urdu('0300') + '1234567'],
] as const) {
  test('accepted, one stored format: ' + name, () => assert.equal(normalizePhoneE164(phone), STORED));
}

for (const prefix of ['0300', '0312', '0321', '0333', '0345', '0355', '0399']) {
  test('every mobile network prefix is accepted: ' + prefix, () => {
    assert.equal(normalizePhoneE164(prefix + '1234567'), '+92' + prefix.slice(1) + '1234567');
  });
}

for (const [why, phone] of [
  ['empty', ''],
  ['spaces only', '     '],
  ['letters', 'abcdefghijk'],
  ['letters inside', '0300abc4567'],
  ['too short', '0300123456'],
  ['too long', '030012345678'],
  ['country code, too short', '+92300123456'],
  ['country code, too long', '+9230012345678'],
  ['landline', '0212345678'],
  ['landline with country code', '+92212345678'],
  ['mobile prefix 04', '04001234567'],
  ['another country', '+14155550123'],
  ['indian number', '+919876543210'],
  ['+92 with two zeros', '+92003001234567'],
  ['+92 0 then a landline', '+920212345678'],
  ['+92 0 and too short', '+9203001234'],
  ['plus in the middle', '0300+1234567'],
  ['two pluses', '++923001234567'],
  ['plus at the end', '03001234567+'],
  ['script-like text', '<script>alert(1)</script>'],
  ['Urdu letters', 'پاکستان'],
  ['urdu digits, too short', urdu('0300123456')],
  ['a number followed by words', '03001234567 call me'],
] as const) {
  test('refused: ' + why, () => {
    assert.equal(normalizePhoneE164(phone), null);
    assert.deepEqual(refusal({ phone }), { path: 'phone', message: 'Enter a valid mobile number, for example 0300 1234567' });
  });
}

test('refused: longer than the phone field allows, even if the digits would fit', () => {
  assert.equal(refusal({ phone: '0300' + ' '.repeat(40) + '1234567' }).path, 'phone');
});

for (const value of [undefined, null, 3001234567, { $gt: '' }, ['03001234567'], true]) {
  test('refused, not a string: ' + JSON.stringify(value), () => {
    assert.equal(normalizePhoneE164(value), null);
    assert.equal(refusal({ phone: value }).path, 'phone');
  });
}

test('the stored format is stable: normalising it again changes nothing', () => {
  assert.equal(normalizePhoneE164(normalizePhoneE164('0300 1234567')), STORED);
});

/* ------------------------------------------- text fields ------------------------------------------- */

test('a full customer parses, with email and note absent reading as null', () => {
  const result = parse({});
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(result.data, { customerName: 'Sara Khan', phone: STORED, address: valid.address, city: 'Karachi', email: null, note: null });
});

for (const [field, tooShort, requiredMessage] of [
  ['customerName', 'A', 'Enter your full name'],
  ['address', 'Short', 'Enter your full delivery address'],
  ['city', 'K', 'Enter your city'],
] as const) {
  test(field + ' is required, in plain words', () => {
    for (const value of [undefined, null, '', '    ', tooShort, 42, { $ne: '' }]) {
      assert.deepEqual(refusal({ [field]: value }), { path: field, message: requiredMessage }, JSON.stringify(value));
    }
  });
}

for (const [field, max, message, base] of [
  ['customerName', CHECKOUT_NAME_MAX, 'Name is too long', 'n'],
  ['address', CHECKOUT_ADDRESS_MAX, 'Address is too long', 'a'],
  ['city', CHECKOUT_CITY_MAX, 'City name is too long', 'c'],
] as const) {
  test(field + ' at its limit is accepted, one past it is refused', () => {
    assert.equal(parse({ [field]: base.repeat(max) }).success, true);
    assert.deepEqual(refusal({ [field]: base.repeat(max + 1) }), { path: field, message });
  });
}

test('Urdu names and addresses are ordinary text', () => {
  const result = parse({ customerName: 'علی رضا', address: 'مکان نمبر ۱۲، گلی ۴، بلاک ۵', city: 'کراچی' });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.customerName, 'علی رضا');
    assert.equal(result.data.address, 'مکان نمبر ۱۲، گلی ۴، بلاک ۵');
    assert.equal(result.data.city, 'کراچی');
  }
});

test('text is trimmed, runs of space and line breaks become one space, control characters go', () => {
  const result = parse({ customerName: '  Sara\t\tKhan\u0000 ', address: 'House 12,\r\nStreet 4,\nBlock 5', city: ' Karachi ' });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.customerName, 'Sara Khan');
    assert.equal(result.data.address, 'House 12, Street 4, Block 5');
    assert.equal(result.data.city, 'Karachi');
  }
});

for (const text of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '"><svg onload=alert(1)>', "Robert'); DROP TABLE orders;--", '{{constructor}}', '$ne', '&lt;b&gt;']) {
  test('script-like text stays plain text, unchanged: ' + text, () => {
    const result = parse({ customerName: text, address: text + ' House 12', city: text, note: text });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.customerName, text);
      assert.equal(result.data.address, text + ' House 12');
      assert.equal(result.data.city, text);
      assert.equal(result.data.note, text);
    }
  });
}

test('a refusal never repeats what was typed', () => {
  const script = '<script>alert(1)</script>';
  for (const overrides of [{ phone: script }, { email: script }, { customerName: script.repeat(10) }, { address: script.repeat(20) }, { city: script.repeat(5) }, { note: script.repeat(30) }]) {
    assert.equal(refusal(overrides).message.includes('<script'), false);
  }
});

/* ------------------------------------------- email and note ------------------------------------------- */

test('email is optional: absent, null and blank all read as none', () => {
  for (const email of [undefined, null, '', '   ']) {
    const result = parse({ email });
    assert.equal(result.success, true, JSON.stringify(email));
    if (result.success) assert.equal(result.data.email, null);
  }
});

test('an email is trimmed and lower-cased', () => {
  const result = parse({ email: '  Sara.Khan@Example.PK ' });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.email, 'sara.khan@example.pk');
});

for (const email of ['sara', 'sara@', '@example.pk', 'sara@example', 'sara khan@example.pk', 'a@b.c', '<script>@x.pk', 'x'.repeat(CHECKOUT_EMAIL_MAX) + '@example.pk', 42]) {
  test('a wrong email is refused: ' + String(email).slice(0, 30), () => {
    assert.deepEqual(refusal({ email }), { path: 'email', message: 'Enter a valid email address, or leave this empty' });
  });
}

test('note is optional: absent, null and blank all read as none', () => {
  for (const note of [undefined, null, '', '  \n ']) {
    const result = parse({ note });
    assert.equal(result.success, true, JSON.stringify(note));
    if (result.success) assert.equal(result.data.note, null);
  }
});

test('a note keeps its line breaks and is limited in length', () => {
  const result = parse({ note: ' Ring the bell\r\nLeave at the gate ' });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.note, 'Ring the bell\nLeave at the gate');
  assert.equal(parse({ note: 'n'.repeat(CHECKOUT_NOTE_MAX) }).success, true);
  assert.deepEqual(refusal({ note: 'n'.repeat(CHECKOUT_NOTE_MAX + 1) }), { path: 'note', message: 'Note is too long' });
});

test('every bad field is reported, so a form can mark them all at once', () => {
  const result = storefrontCheckoutCustomerSchema.safeParse({ customerName: '', phone: 'x', address: '', city: '', email: 'x', note: 'n'.repeat(CHECKOUT_NOTE_MAX + 1) });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(new Set(result.error.issues.map((issue) => issue.path[0])), new Set(['customerName', 'phone', 'address', 'city', 'email', 'note']));
  }
});

/* ------------------------------------------- quote ------------------------------------------- */

const line = { productId: 'p1', variantId: 'v1', title: 'Shirt', variantTitle: 'Default', unitPrice: 1000, qty: 2, lineTotal: 2000, issue: null, availableQty: 5 };
const quote = { lines: [line], subtotal: 2000, deliveryCharges: 250, discount: 0, total: 2250, canCheckout: true };

test('the quote carries line prices, subtotal, delivery, discount and total', () => {
  const parsed = storefrontCartQuoteResponseSchema.parse({ data: quote });
  assert.deepEqual(parsed.data, quote);
});

test('a quote from a backend that has no discount yet reads as discount 0', () => {
  const { discount: _discount, ...older } = quote;
  assert.equal(storefrontCartQuoteSchema.parse(older).discount, 0);
});

test('the contract refuses money that is not whole rupees', () => {
  for (const bad of [{ subtotal: 10.5 }, { deliveryCharges: -1 }, { discount: 0.5 }, { total: Number.NaN }]) {
    assert.equal(storefrontCartQuoteSchema.safeParse({ ...quote, ...bad }).success, false, JSON.stringify(bad));
    assert.equal(storefrontQuoteTotalsSchema.safeParse({ subtotal: 1, deliveryCharges: 1, discount: 0, total: 2, ...bad }).success, false, JSON.stringify(bad));
  }
});

test('prices a browser sends with a quote request are dropped', () => {
  const parsed = storefrontCartQuoteRequestSchema.parse({ lines: [{ productId: 'p1', qty: 1, unitPrice: 1, price: 1, lineTotal: 1 }], subtotal: 1, total: 1, discount: 1000 });
  assert.deepEqual(parsed, { lines: [{ productId: 'p1', qty: 1 }] });
});

test('the package root exports the same schemas the browser entry does', () => {
  assert.equal(root.storefrontCheckoutCustomerSchema, storefrontCheckoutCustomerSchema);
  assert.equal(root.storefrontCartQuoteSchema, storefrontCartQuoteSchema);
  assert.equal(root.normalizePhoneE164, normalizePhoneE164);
});
