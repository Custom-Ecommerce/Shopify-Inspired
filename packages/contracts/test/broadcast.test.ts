import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BROADCAST_RECIPIENT_CAP,
  broadcastListQuerySchema,
  broadcastPreviewRequestSchema,
  createBroadcastRequestSchema,
  customerListQuerySchema,
  unsubscribeRequestSchema,
} from '../src/broadcast';
import { EMAIL_FOOTER_MAX, MESSAGE_VARIABLES, WHATSAPP_TEMPLATE_MAX, storeSettingsUpdateSchema, unknownMessageVariables } from '../src/store-settings';

// Sprint 4 EP-07.US04 (broadcast) and EP-07.US02.T02 (message overrides): the request shapes.

const issueOf = (schema: { safeParse(value: unknown): { success: boolean; error?: { issues: Array<{ path: PropertyKey[] }> } } }, value: unknown): string | null => {
  const parsed = schema.safeParse(value);
  return parsed.success ? null : parsed.error!.issues[0]!.path.map(String).join('.');
};

test('the broadcast text is plain: the subject is one line up to 120, the message up to 2000, no HTML', () => {
  const ok = createBroadcastRequestSchema.parse({ subject: '  Eid\n sale  ', message: 'Line one\r\nLine two', expectedCount: 3 });
  assert.deepEqual(ok, { subject: 'Eid sale', message: 'Line one\nLine two', expectedCount: 3 });
  assert.equal(issueOf(createBroadcastRequestSchema, { subject: 'x'.repeat(121), message: 'm', expectedCount: 1 }), 'subject');
  assert.equal(issueOf(createBroadcastRequestSchema, { subject: 'x'.repeat(120), message: 'm', expectedCount: 1 }), null);
  assert.equal(issueOf(createBroadcastRequestSchema, { subject: 's', message: 'm'.repeat(2001), expectedCount: 1 }), 'message');
  assert.equal(issueOf(createBroadcastRequestSchema, { subject: 's', message: 'm'.repeat(2000), expectedCount: 1 }), null);
  assert.equal(issueOf(createBroadcastRequestSchema, { subject: '<b>s</b>', message: 'm', expectedCount: 1 }), 'subject');
  assert.equal(issueOf(createBroadcastRequestSchema, { subject: 's', message: 'a > b', expectedCount: 1 }), 'message');
  assert.equal(issueOf(createBroadcastRequestSchema, { subject: ' ', message: 'm', expectedCount: 1 }), 'subject');
  assert.equal(issueOf(createBroadcastRequestSchema, { subject: 's', message: '', expectedCount: 1 }), 'message');
});

test('expectedCount is a whole number from 0 to the cap plus one, and unknown fields are refused', () => {
  assert.equal(BROADCAST_RECIPIENT_CAP, 500);
  const base = { subject: 's', message: 'm' };
  assert.equal(issueOf(createBroadcastRequestSchema, base), 'expectedCount');
  assert.equal(issueOf(createBroadcastRequestSchema, { ...base, expectedCount: 1.5 }), 'expectedCount');
  assert.equal(issueOf(createBroadcastRequestSchema, { ...base, expectedCount: -1 }), 'expectedCount');
  assert.equal(issueOf(createBroadcastRequestSchema, { ...base, expectedCount: '3' }), 'expectedCount');
  assert.equal(issueOf(createBroadcastRequestSchema, { ...base, expectedCount: 501 }), null);
  assert.equal(issueOf(createBroadcastRequestSchema, { ...base, expectedCount: 502 }), 'expectedCount');
  assert.equal(createBroadcastRequestSchema.safeParse({ ...base, expectedCount: 1, store: 'x' }).success, false);
  assert.equal(broadcastPreviewRequestSchema.safeParse({ ...base, expectedCount: 1 }).success, false);
  assert.equal(broadcastPreviewRequestSchema.safeParse(base).success, true);
});

test('the customer and history queries have defaults, limits, and no unknown keys', () => {
  assert.deepEqual(customerListQuerySchema.parse({}), { page: 1, limit: 20 });
  assert.deepEqual(customerListQuerySchema.parse({ page: '2', limit: '50', phone: '1' }), { page: 2, limit: 50, phone: '1' });
  assert.equal(customerListQuerySchema.safeParse({ limit: '51' }).success, false);
  assert.equal(customerListQuerySchema.safeParse({ phone: '0' }).success, false);
  assert.equal(customerListQuerySchema.safeParse({ store: 'x' }).success, false);
  assert.deepEqual(broadcastListQuerySchema.parse({}), { page: 1, limit: 20 });
  assert.equal(broadcastListQuerySchema.safeParse({ page: '0' }).success, false);
});

test('the unsubscribe request needs a store id, an email and a 64-character hex signature', () => {
  const sig = 'a'.repeat(64);
  assert.equal(unsubscribeRequestSchema.safeParse({ store: '65a000000000000000000011', email: 'a@b.com', sig }).success, true);
  assert.equal(unsubscribeRequestSchema.safeParse({ store: 'nope', email: 'a@b.com', sig }).success, false);
  assert.equal(unsubscribeRequestSchema.safeParse({ store: '65a000000000000000000011', email: 'a@b.com', sig: 'A'.repeat(64) }).success, false);
  assert.equal(unsubscribeRequestSchema.safeParse({ store: '65a000000000000000000011', email: 'a@b.com', sig: 'a'.repeat(63) }).success, false);
});

// ------------------------------------------------------------------------------------------------ message overrides

test('the WhatsApp text may use only the named variables, written {name}', () => {
  assert.deepEqual([...MESSAGE_VARIABLES], ['storeName', 'customerName', 'orderNumber', 'courier', 'trackingNumber', 'trackingLink']);
  assert.deepEqual(unknownMessageVariables('Hi {customerName} {oops} {oops} {orderId}'), ['oops', 'orderId']);
  assert.deepEqual(unknownMessageVariables('No variables, and {{double}} braces are only {double}'), ['double']);
  const ok = storeSettingsUpdateSchema.parse({ messages: { whatsappTemplate: 'Hi {customerName}, { orderNumber } is ready: {trackingLink}' } });
  assert.equal(ok.messages?.whatsappTemplate, 'Hi {customerName}, { orderNumber } is ready: {trackingLink}');
});

test('an unknown variable is refused with the field in the path and the allowed names in the message', () => {
  const parsed = storeSettingsUpdateSchema.safeParse({ messages: { whatsappTemplate: 'Hi {customerName} {shoeSize}' } });
  assert.equal(parsed.success, false);
  const issue = parsed.error!.issues[0]!;
  assert.equal(issue.path.join('.'), 'messages.whatsappTemplate');
  assert.ok(issue.message.includes('{shoeSize}') && issue.message.includes('{orderNumber}'));
});

test('the messages group: lengths, plain text, empty clears, strict, and the group is part of the grouped update', () => {
  const field = (messages: unknown) => issueOf(storeSettingsUpdateSchema, { messages });
  assert.equal(WHATSAPP_TEMPLATE_MAX, 500);
  assert.equal(EMAIL_FOOTER_MAX, 300);
  assert.equal(field({ whatsappTemplate: 'x'.repeat(500), emailFooter: 'y'.repeat(300) }), null);
  assert.equal(field({ whatsappTemplate: 'x'.repeat(501) }), 'messages.whatsappTemplate');
  assert.equal(field({ emailFooter: 'y'.repeat(301) }), 'messages.emailFooter');
  assert.equal(field({ whatsappTemplate: 'a <b>' }), 'messages.whatsappTemplate');
  assert.equal(field({ emailFooter: '<script>' }), 'messages.emailFooter');
  assert.equal(field({ emailFooter: 'a', other: 'b' }), 'messages');
  const cleared = storeSettingsUpdateSchema.parse({ messages: { whatsappTemplate: '', emailFooter: null } });
  assert.deepEqual(cleared.messages, { whatsappTemplate: null, emailFooter: null });
  const multi = storeSettingsUpdateSchema.parse({ messages: { emailFooter: 'Line one\r\nLine two' } });
  assert.equal(multi.messages?.emailFooter, 'Line one\nLine two');
});
