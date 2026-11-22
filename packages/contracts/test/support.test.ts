import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contactReplySchema,
  contactStatusUpdateSchema,
  platformContactRequestSchema,
  storeContactRequestSchema,
  ticketCloseSchema,
  ticketCreateSchema,
  ticketReplySchema,
  ticketStatusUpdateSchema,
} from '../src/support';

// Sprint 7 (S7-B4): the contact and ticket contracts. Strict; the first issue names the field.

const ID = '65a000000000000000000001';
const firstField = (result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; code: string; keys?: string[] }> } }): string | undefined => {
  if (result.success) return undefined;
  const issue = result.error!.issues[0]!;
  return issue.code === 'unrecognized_keys' ? issue.keys![0] : String(issue.path[0]);
};
const good = { name: 'Sara Khan', email: 'sara@example.com', message: 'Do you deliver?', consent: true };

test('store contact: a name, a message and consent, with an email or a phone', () => {
  assert.equal(storeContactRequestSchema.safeParse(good).success, true);
  assert.equal(storeContactRequestSchema.safeParse({ name: 'Ali', phone: '0300 1234567', message: 'Is it in stock?', consent: true }).success, true);
  assert.equal(storeContactRequestSchema.safeParse({ ...good, email: '', phone: '+92 300 1234567' }).success, true, 'an empty email with a phone');
  assert.equal(firstField(storeContactRequestSchema.safeParse({ name: 'Ali', message: 'Is it in stock?', consent: true })), 'email', 'neither');
  assert.equal(firstField(storeContactRequestSchema.safeParse({ ...good, email: '', phone: '' })), 'email');
});

test('store contact: the limits, each naming its field', () => {
  const bad: Array<[Record<string, unknown>, string]> = [
    [{ ...good, name: '' }, 'name'],
    [{ ...good, name: 'x'.repeat(101) }, 'name'],
    [{ ...good, email: 'nope' }, 'email'],
    [{ ...good, email: 'x'.repeat(201) }, 'email'],
    [{ ...good, phone: 'abc' }, 'phone'],
    [{ ...good, phone: '1'.repeat(31) }, 'phone'],
    [{ ...good, message: 'hi' }, 'message'],
    [{ ...good, message: 'x'.repeat(3001) }, 'message'],
    [{ ...good, consent: false }, 'consent'],
    [{ ...good, consent: undefined }, 'consent'],
  ];
  for (const [body, field] of bad) assert.equal(firstField(storeContactRequestSchema.safeParse(body)), field, JSON.stringify(body).slice(0, 60));
  assert.equal(storeContactRequestSchema.safeParse({ ...good, message: 'x'.repeat(3000) }).success, true);
  assert.equal(storeContactRequestSchema.safeParse({ ...good, name: 'x'.repeat(100) }).success, true);
});

test('the honeypot field (website) is the one extra key both forms accept; every other extra key is refused', () => {
  assert.equal(storeContactRequestSchema.safeParse({ ...good, website: '' }).success, true);
  assert.equal(storeContactRequestSchema.safeParse({ ...good, website: 'http://spam.test' }).success, true, 'a bot fills it: the route, not the contract, decides');
  for (const key of ['store', 'status', 'revision', 'scope', 'replies', 'id']) {
    assert.equal(firstField(storeContactRequestSchema.safeParse({ ...good, [key]: 'x' })), key, 'store ' + key);
    assert.equal(firstField(platformContactRequestSchema.safeParse({ ...good, [key]: 'x' })), key, 'platform ' + key);
  }
});

test('platform contact: the email is required (the answer goes there) and there is no phone', () => {
  assert.equal(platformContactRequestSchema.safeParse(good).success, true);
  assert.equal(firstField(platformContactRequestSchema.safeParse({ name: 'V', message: 'Hello platform', consent: true })), 'email');
  assert.equal(firstField(platformContactRequestSchema.safeParse({ ...good, email: 'bad' })), 'email');
  assert.equal(firstField(platformContactRequestSchema.safeParse({ ...good, phone: '0300 1234567' })), 'phone');
});

test('inbox updates: read or closed only (replied is only ever set by a reply); a reply is text with a revision', () => {
  assert.equal(contactStatusUpdateSchema.safeParse({ revision: 0, status: 'read' }).success, true);
  assert.equal(contactStatusUpdateSchema.safeParse({ revision: 3, status: 'closed' }).success, true);
  for (const body of [{ revision: 0, status: 'replied' }, { revision: 0, status: 'new' }, { revision: 0 }, { status: 'read' }, { revision: -1, status: 'read' }, { revision: 1.5, status: 'read' }]) {
    assert.equal(contactStatusUpdateSchema.safeParse(body).success, false, JSON.stringify(body));
  }
  assert.equal(contactReplySchema.safeParse({ revision: 0, text: ' Yes we do ' }).success, true);
  for (const body of [{ revision: 0, text: '' }, { revision: 0, text: '   ' }, { revision: 0, text: 'x'.repeat(3001) }, { text: 'No revision' }, { revision: 0, text: 'Hi', channel: 'email' }]) {
    assert.equal(contactReplySchema.safeParse(body).success, false, JSON.stringify(body).slice(0, 60));
  }
});

test('ticket create: a subject (3 to 150) and a message (5 to 3000); the store (an id) and the order number are optional; nothing else', () => {
  assert.equal(ticketCreateSchema.safeParse({ subject: 'Payout question', message: 'When is it?' }).success, true);
  assert.equal(ticketCreateSchema.safeParse({ subject: 'Payout question', message: 'When is it?', store: ID, orderRef: 'ORD-1' }).success, true);
  const bad: Array<[Record<string, unknown>, string]> = [
    [{}, 'subject'],
    [{ subject: 'ab', message: 'When is it?' }, 'subject'],
    [{ subject: 'x'.repeat(151), message: 'When is it?' }, 'subject'],
    [{ subject: 'Payout', message: 'hi' }, 'message'],
    [{ subject: 'Payout', message: 'x'.repeat(3001) }, 'message'],
    [{ subject: 'Payout', message: 'When is it?', store: 'nope' }, 'store'],
    [{ subject: 'Payout', message: 'When is it?', orderRef: 'x'.repeat(41) }, 'orderRef'],
    [{ subject: 'Payout', message: 'When is it?', seller: ID }, 'seller'],
    [{ subject: 'Payout', message: 'When is it?', status: 'closed' }, 'status'],
    [{ subject: 'Payout', message: 'When is it?', messages: [] }, 'messages'],
  ];
  for (const [body, field] of bad) assert.equal(firstField(ticketCreateSchema.safeParse(body)), field, JSON.stringify(body).slice(0, 60));
});

test('ticket reply, close and status: the revision is required; the text is 1 to 3000; the status is open, answered or closed', () => {
  assert.equal(ticketReplySchema.safeParse({ revision: 0, text: 'Hello' }).success, true);
  assert.equal(firstField(ticketReplySchema.safeParse({ text: 'Hello' })), 'revision');
  assert.equal(firstField(ticketReplySchema.safeParse({ revision: 0, text: '' })), 'text');
  assert.equal(firstField(ticketReplySchema.safeParse({ revision: 0, text: 'x'.repeat(3001) })), 'text');
  assert.equal(firstField(ticketReplySchema.safeParse({ revision: 0, text: 'Hi', from: 'admin' })), 'from');
  assert.equal(ticketCloseSchema.safeParse({ revision: 2 }).success, true);
  assert.equal(firstField(ticketCloseSchema.safeParse({})), 'revision');
  assert.equal(firstField(ticketCloseSchema.safeParse({ revision: 0, status: 'open' })), 'status');
  for (const status of ['open', 'answered', 'closed']) assert.equal(ticketStatusUpdateSchema.safeParse({ revision: 0, status }).success, true, status);
  assert.equal(firstField(ticketStatusUpdateSchema.safeParse({ revision: 0, status: 'deleted' })), 'status');
});
