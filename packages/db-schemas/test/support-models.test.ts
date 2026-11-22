import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { ContactMessage, SupportTicket } from '../src';

// Sprint 7 (S7-B4): the ContactMessage and SupportTicket models, validated in memory. No database connection is needed.

const oid = () => new mongoose.Types.ObjectId();
const contact = (over: Record<string, unknown> = {}) => new ContactMessage({ scope: 'store', store: oid(), name: 'Sara', email: 'sara@example.com', message: 'Hello there', consent: true, ...over });
const ticket = (over: Record<string, unknown> = {}) => new SupportTicket({ seller: oid(), subject: 'Help', messages: [{ from: 'seller', text: 'Please help', at: new Date(), byId: 'u1' }], ...over });

test('a contact message needs a scope, a name and a message; a store message needs a store, a platform message does not', () => {
  const empty = new ContactMessage({}).validateSync();
  assert.ok(empty?.errors.scope);
  assert.ok(empty?.errors.name);
  assert.ok(empty?.errors.message);
  assert.ok(contact({ store: undefined }).validateSync()?.errors.store, 'a store message without a store');
  assert.equal(contact().validateSync(), undefined);
  assert.equal(contact({ scope: 'platform', store: undefined }).validateSync(), undefined);
  assert.ok(contact({ scope: 'other' }).validateSync()?.errors.scope);
});

test('a contact message starts new with revision 0, no replies and no consent unless given', () => {
  const doc = contact({ consent: undefined });
  assert.equal(doc.status, 'new');
  assert.equal(doc.revision, 0);
  assert.deepEqual([...doc.replies], []);
  assert.equal(doc.consent, false);
  assert.equal(doc.phone, null);
});

test('the contact field limits: name 100, email 200, phone 30, message 3000; the status is one of four', () => {
  assert.equal(contact({ name: 'x'.repeat(100), message: 'x'.repeat(3000), phone: '1'.repeat(30) }).validateSync(), undefined);
  assert.ok(contact({ name: 'x'.repeat(101) }).validateSync()?.errors.name);
  assert.ok(contact({ email: 'x'.repeat(201) }).validateSync()?.errors.email);
  assert.ok(contact({ phone: '1'.repeat(31) }).validateSync()?.errors.phone);
  assert.ok(contact({ message: 'x'.repeat(3001) }).validateSync()?.errors.message);
  for (const status of ['new', 'read', 'replied', 'closed']) assert.equal(contact({ status }).validateSync(), undefined, status);
  assert.ok(contact({ status: 'deleted' }).validateSync()?.errors.status);
});

test('a reply carries text, a date, who and a channel (email or whatsapp)', () => {
  assert.equal(contact({ replies: [{ text: 'Yes', at: new Date(), by: 'u1', channel: 'email' }] }).validateSync(), undefined);
  assert.ok(contact({ replies: [{ text: 'Yes', at: new Date(), by: 'u1', channel: 'sms' }] }).validateSync());
  assert.ok(contact({ replies: [{ text: 'x'.repeat(3001), at: new Date(), by: 'u1', channel: 'email' }] }).validateSync());
});

test('contact message indexes: {store, status, createdAt} and {scope, status, createdAt}, none unique', () => {
  const indexes = ContactMessage.schema.indexes();
  const keys = indexes.map(([fields]) => Object.entries(fields).map(([k, d]) => k + ':' + d).join('+'));
  assert.ok(keys.includes('store:1+status:1+createdAt:-1'));
  assert.ok(keys.includes('scope:1+status:1+createdAt:-1'));
  assert.equal(indexes.some(([, options]) => options?.unique === true), false);
});

test('a ticket needs a seller and a subject (max 150); it starts open with revision 0; the store and the order reference are optional', () => {
  const empty = new SupportTicket({}).validateSync();
  assert.ok(empty?.errors.seller);
  assert.ok(empty?.errors.subject);
  const doc = ticket();
  assert.equal(doc.validateSync(), undefined);
  assert.equal(doc.status, 'open');
  assert.equal(doc.revision, 0);
  assert.equal(doc.store, null);
  assert.equal(doc.orderRef, null);
  assert.ok(ticket({ subject: 'x'.repeat(151) }).validateSync()?.errors.subject);
  assert.ok(ticket({ orderRef: 'x'.repeat(41) }).validateSync()?.errors.orderRef);
});

test('a ticket message is from seller or admin, with text up to 3000; the status is open, answered or closed', () => {
  assert.equal(ticket({ messages: [{ from: 'admin', text: 'x'.repeat(3000), at: new Date(), byId: 'a1' }] }).validateSync(), undefined);
  assert.ok(ticket({ messages: [{ from: 'robot', text: 'x', at: new Date(), byId: 'a1' }] }).validateSync());
  assert.ok(ticket({ messages: [{ from: 'seller', text: 'x'.repeat(3001), at: new Date(), byId: 'a1' }] }).validateSync());
  assert.ok(ticket({ messages: [{ from: 'seller', at: new Date(), byId: 'a1' }] }).validateSync());
  for (const status of ['open', 'answered', 'closed']) assert.equal(ticket({ status }).validateSync(), undefined, status);
  assert.ok(ticket({ status: 'pending' }).validateSync()?.errors.status);
});

test('ticket indexes: {seller, createdAt} and {status, updatedAt}, none unique', () => {
  const indexes = SupportTicket.schema.indexes();
  const keys = indexes.map(([fields]) => Object.entries(fields).map(([k, d]) => k + ':' + d).join('+'));
  assert.ok(keys.includes('seller:1+createdAt:-1'));
  assert.ok(keys.includes('status:1+updatedAt:-1'));
  assert.equal(indexes.some(([, options]) => options?.unique === true), false);
});
