import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customerListQuerySchema } from '../src/broadcast';
import {
  CUSTOMER_CSV_COLUMNS,
  CUSTOMER_EXPORT_MAX_ROWS,
  CUSTOMER_NOTE_MAX,
  customerExportQuerySchema,
  customerNoteRequestSchema,
  normalizeCustomerKey,
} from '../src/customers';
import { normalizePhoneE164 } from '../src/checkout';

// Sprint 5 EP-10.US01 / US02 (D-107, D-108): the customer key, the note request and the list and export queries.

const fieldOf = (schema: { safeParse(value: unknown): { success: boolean; error?: { issues: Array<{ path: PropertyKey[] }> } } }, value: unknown): string | null => {
  const parsed = schema.safeParse(value);
  return parsed.success ? null : parsed.error!.issues[0]!.path.map(String).join('.');
};

test('one phone rule: the formats seen in orders all give +923xxxxxxxxx, and anything else is not a phone', () => {
  for (const spelling of ['03001234567', '3001234567', '+923001234567', '00923001234567', '923001234567', '0300-1234567', '0300 123 4567', '+92 0300 1234567', '(0300) 1234567', '٠٣٠٠١٢٣٤٥٦٧', '۰۳۰۰۱۲۳۴۵۶۷']) {
    assert.equal(normalizePhoneE164(spelling), '+923001234567', spelling);
  }
  for (const bad of ['', '   ', 'abc', '0300', '0300123456', '030012345678', '+441234567890', '02112345678', '0900 1234567', 12345, null, undefined]) {
    assert.equal(normalizePhoneE164(bad), null, String(bad));
  }
});

test('the customer key is the normalized phone or the lower-case email, nothing else', () => {
  assert.equal(normalizeCustomerKey('0300 1234567'), '+923001234567');
  assert.equal(normalizeCustomerKey(' +92-300-1234567 '), '+923001234567');
  assert.equal(normalizeCustomerKey('Ayesha@Example.COM'), 'ayesha@example.com');
  assert.equal(normalizeCustomerKey('  a.b@c.pk '), 'a.b@c.pk');
  for (const bad of ['', 'abc', '12345', '+441234567890', 'a@b', 'a b@c.com', '@c.com', '<x>@c.com', 'x'.repeat(250) + '@c.com', 42, null, undefined]) {
    assert.equal(normalizeCustomerKey(bad), null, String(bad));
  }
});

test('the note request: plain text, 500 characters, up to 5 tags of 20, at least one field, no unknown field', () => {
  assert.deepEqual(customerNoteRequestSchema.parse({ note: '  Prefers calls.\r\nNo Sunday.  ', tags: [' VIP ', 'vip', 'Eid  buyer'] }), {
    note: 'Prefers calls.\nNo Sunday.',
    tags: ['VIP', 'Eid buyer'],
  });
  assert.deepEqual(customerNoteRequestSchema.parse({ note: '   ' }), { note: '' }, 'an empty note clears it');
  assert.deepEqual(customerNoteRequestSchema.parse({ tags: [] }), { tags: [] });
  assert.equal(customerNoteRequestSchema.safeParse({ note: 'x'.repeat(CUSTOMER_NOTE_MAX) }).success, true);

  assert.equal(fieldOf(customerNoteRequestSchema, {}), 'note');
  assert.equal(fieldOf(customerNoteRequestSchema, { note: 'x'.repeat(CUSTOMER_NOTE_MAX + 1) }), 'note');
  assert.equal(fieldOf(customerNoteRequestSchema, { note: 'a <b> c' }), 'note');
  assert.equal(fieldOf(customerNoteRequestSchema, { note: 1 }), 'note');
  assert.equal(fieldOf(customerNoteRequestSchema, { tags: ['1', '2', '3', '4', '5', '6'] }), 'tags');
  assert.equal(fieldOf(customerNoteRequestSchema, { tags: ['x'.repeat(21)] }), 'tags.0');
  assert.equal(fieldOf(customerNoteRequestSchema, { tags: ['ok', '  '] }), 'tags.1');
  assert.equal(fieldOf(customerNoteRequestSchema, { tags: ['<i>'] }), 'tags.0');
  assert.equal(fieldOf(customerNoteRequestSchema, { tags: 'vip' }), 'tags');
  assert.equal(fieldOf(customerNoteRequestSchema, { note: 'ok', store: 'x' }), 'store');
});

test('control characters in a note become spaces and a newline stays; in a tag every line break becomes a space', () => {
  const parsed = customerNoteRequestSchema.parse({ note: 'a\u0000b\tc\nd', tags: ['x\ny'] });
  assert.equal(parsed.note, 'a b c\nd');
  assert.deepEqual(parsed.tags, ['x y']);
});

test('the list query keeps the Sprint 4 shape and adds q, sort, repeat, hasEmail and unsubscribed', () => {
  assert.deepEqual(customerListQuerySchema.parse({}), { page: 1, limit: 20 });
  assert.deepEqual(customerListQuerySchema.parse({ page: '2', limit: '50', phone: '1' }), { page: 2, limit: 50, phone: '1' });
  assert.deepEqual(customerListQuerySchema.parse({ q: '  ayesha ', sort: 'total_spent', repeat: '1', hasEmail: '1', unsubscribed: '1' }), {
    page: 1,
    limit: 20,
    q: 'ayesha',
    sort: 'total_spent',
    repeat: '1',
    hasEmail: '1',
    unsubscribed: '1',
  });
  assert.equal(fieldOf(customerListQuerySchema, { sort: 'name' }), 'sort');
  assert.equal(fieldOf(customerListQuerySchema, { q: 'x'.repeat(81) }), 'q');
  assert.equal(fieldOf(customerListQuerySchema, { repeat: '0' }), 'repeat');
  assert.equal(fieldOf(customerListQuerySchema, { store: 'x' }), 'store');
});

test('the export query has the filters but no paging', () => {
  assert.deepEqual(customerExportQuerySchema.parse({}), {});
  assert.deepEqual(customerExportQuerySchema.parse({ q: 'x', sort: 'orders', phone: '1' }), { q: 'x', sort: 'orders', phone: '1' });
  assert.equal(fieldOf(customerExportQuerySchema, { page: '1' }), 'page');
  assert.equal(fieldOf(customerExportQuerySchema, { limit: '10' }), 'limit');
});

test('the export constants', () => {
  assert.equal(CUSTOMER_EXPORT_MAX_ROWS, 5000);
  assert.deepEqual([...CUSTOMER_CSV_COLUMNS], ['Name', 'Phone', 'Email', 'Orders', 'Delivered', 'Total spent', 'Last order', 'Unsubscribed']);
});
