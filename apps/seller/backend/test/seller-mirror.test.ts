import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { ensureSellerMirror, sellerMirrorWrite } from '@/lib/seller-mirror';

// Sprint 5 EP-11.US04.T02 (D-106): the `sellers` mirror row at store creation. Same shape as scripts/lib/bootstrap-admin-plan.mjs:
// _id = the owner's user id (an ObjectId), sellerId = the same id as text. Idempotent, best effort, never throws.

const OWNER = '65a000000000000000000001';
const NOW = new Date('2026-11-20T10:00:00Z');

test('the write is an upsert of { _id: the owner id } that only sets on insert, with sellerId as the same id as text', () => {
  const { filter, update } = sellerMirrorWrite(OWNER, NOW);
  assert.ok(filter._id instanceof mongoose.Types.ObjectId);
  assert.equal(String(filter._id), OWNER);
  assert.deepEqual(Object.keys(update), ['$setOnInsert'], 'an existing row is never changed');
  assert.deepEqual(update.$setOnInsert, { sellerId: OWNER, createdAt: NOW, updatedAt: NOW });
});

test('ensureSellerMirror upserts once and reports true; a repeat is the same idempotent write', async () => {
  const calls: Array<{ filter: Record<string, unknown>; update: Record<string, unknown>; options: { upsert: boolean } }> = [];
  const deps = {
    ready: () => true,
    now: () => NOW,
    collection: () => ({
      updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>, options: { upsert: boolean }) => {
        calls.push({ filter, update, options });
        return { acknowledged: true };
      },
    }),
  };
  assert.equal(await ensureSellerMirror(OWNER, deps), true);
  assert.equal(await ensureSellerMirror(new mongoose.Types.ObjectId(OWNER), deps), true, 'an ObjectId is accepted too');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0]!.options.upsert, true);
  assert.equal(String(calls[0]!.filter._id), OWNER);
});

test('without an open connection nothing is attempted (a driver call would wait for one), and the answer is false', async () => {
  let touched = false;
  const deps = { ready: () => false, collection: () => ({ updateOne: async () => void (touched = true) }) };
  assert.equal(await ensureSellerMirror(OWNER, deps as never), false);
  assert.equal(touched, false);
});

test('a bad owner id is false and writes nothing', async () => {
  let touched = false;
  const deps = { ready: () => true, collection: () => ({ updateOne: async () => void (touched = true) }) };
  for (const bad of ['', 'nope', null, undefined, 42]) assert.equal(await ensureSellerMirror(bad, deps as never), false, String(bad));
  assert.equal(touched, false);
});

test('a lost race (duplicate key) is success, any other failure is false with one log line and no throw', async () => {
  const logged: unknown[][] = [];
  const quiet = console.error;
  console.error = (...args: unknown[]) => void logged.push(args);
  try {
    const dup = { ready: () => true, collection: () => ({ updateOne: async () => Promise.reject(Object.assign(new Error('E11000'), { code: 11000 })) }) };
    assert.equal(await ensureSellerMirror(OWNER, dup as never), true);
    assert.equal(logged.length, 0);
    const down = { ready: () => true, collection: () => ({ updateOne: async () => Promise.reject(new Error('connection to mongodb://user:secret@host failed')) }) };
    assert.equal(await ensureSellerMirror(OWNER, down as never), false);
    assert.equal(logged.length, 1, 'one log line');
    assert.equal(JSON.stringify(logged).includes('secret'), false, 'only the error name is logged, never its message');
  } finally {
    console.error = quiet;
  }
});
