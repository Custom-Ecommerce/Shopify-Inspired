import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_PUSH_KINDS,
  EXPO_PUSH_URL,
  PUSH_DAILY_QUOTA,
  PUSH_ROLE_TABLE,
  SELLER_PUSH_KINDS,
  adminRecipients,
  createExpoPushClient,
  createLogProvider,
  enqueuePush,
  flushOutbox,
  isExpoPushToken,
  pushContent,
  isQuietTime, readPushPrefs, sendPushEvent,
  storeRecipients,
  type NotificationOutboxModel,
  type PushChannel,
  type PushDeps,
  type PushMessage,
  type PushSendResult,
} from '../src/index';

// Sprint 9 (EP-31.US02): push through the outbox, with a fake push service. No database and no network.

type Row = Record<string, any>;
const TOKEN = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const TOKEN2 = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';

const matchValue = (actual: any, condition: any): boolean => {
  if (condition !== null && typeof condition === 'object' && !(condition instanceof Date) && !Array.isArray(condition)) {
    return Object.entries(condition).every(([op, value]: [string, any]) => {
      if (op === '$in') return value.some((v: any) => (v === null ? actual == null : String(v) === String(actual)));
      if (op === '$lt') return actual < value;
      if (op === '$lte') return actual instanceof Date && actual.getTime() <= value.getTime();
      if (op === '$gt') return actual instanceof Date && actual.getTime() > value.getTime();
      if (op === '$type') return typeof actual === value;
      throw new Error('fake model: unsupported operator ' + op);
    });
  }
  return condition === null ? actual == null : String(actual) === String(condition);
};
const matches = (row: Row, filter: Row) => Object.entries(filter).every(([k, v]) => matchValue(row[k], v));

function fakeOutbox() {
  const rows: Row[] = [];
  let next = 1;
  const model = {
    async create(doc: Row) {
      if (doc.dedupeKey !== undefined && rows.some((r) => r.dedupeKey === doc.dedupeKey)) throw Object.assign(new Error('E11000'), { code: 11000 });
      const row = { _id: 'row' + next++, ...doc };
      rows.push(row);
      return { ...row };
    },
    findOne: (f: Row) => ({ lean: async () => rows.find((r) => matches(r, f)) ?? null }),
    find: (f: Row) => {
      const q = { sort: () => q, limit: () => q, lean: async () => rows.filter((r) => matches(r, f)).map((r) => ({ ...r })) };
      return q;
    },
    findOneAndUpdate: (f: Row, update: Row) => ({
      lean: async () => {
        const row = rows.find((r) => matches(r, f));
        if (!row) return null;
        Object.assign(row, update.$set ?? {});
        for (const [k, by] of Object.entries(update.$inc ?? {})) row[k] += by as number;
        return { ...row };
      },
    }),
  };
  return { rows, model: model as unknown as NotificationOutboxModel };
}

function fakePush(answers: PushSendResult[] = []) {
  const sent: PushMessage[] = [];
  const dead: string[] = [];
  const channel: PushChannel = {
    client: {
      name: 'fake',
      async send(message) {
        sent.push(message);
        return answers.shift() ?? { ok: true, ticketId: 't' + sent.length };
      },
    },
    onDeadToken: async (token) => void dead.push(token),
  };
  return { sent, dead, channel };
}

const NOW = new Date('2026-11-26T10:00:00Z');
const quiet = () => {};

function world(over: { users?: Row[]; devices?: Row[]; members?: Row[] } = {}) {
  const outbox = fakeOutbox();
  const push = fakePush();
  const users: Row[] = over.users ?? [
    { _id: 'owner', accountStatus: 'active', tokenVersion: 0 },
    { _id: 'manager', accountStatus: 'active', tokenVersion: 0 },
    { _id: 'helper', accountStatus: 'active', tokenVersion: 0 },
  ];
  const live = { app: 'seller', revokedAt: null, refreshExpiresAt: new Date(NOW.getTime() + 1000), tokenVersion: 0 };
  const devices: Row[] = over.devices ?? [
    { _id: 'd1', user: 'owner', pushToken: TOKEN, ...live },
    { _id: 'd2', user: 'manager', pushToken: TOKEN2, ...live },
    { _id: 'd3', user: 'helper', pushToken: 'ExponentPushToken[cccccccccccccccccccccc]', ...live },
  ];
  const members: Row[] = over.members ?? [
    { store: 's1', user: 'manager', role: 'manager', status: 'active' },
    { store: 's1', user: 'helper', role: 'support', status: 'active' },
    { store: 's1', user: 'gone', role: 'manager', status: 'disabled' },
  ];
  const counters = new Map<string, number>();
  const query = (value: () => unknown) => ({ select: () => ({ lean: async () => value() }) });
  const deps: PushDeps = {
    outbox: outbox.model,
    channel: push.channel,
    models: {
      devices: { find: (f) => query(() => devices.filter((r) => matches(r, f))) },
      users: { find: (f) => query(() => users.filter((r) => matches(r, f))) },
      stores: { findById: (id) => query(() => (id === 's1' ? { owner: 'owner' } : null)) },
      members: { find: (f) => query(() => members.filter((r) => matches(r, f))) },
    },
    count: async (key) => {
      const n = (counters.get(key) ?? 0) + 1;
      counters.set(key, n);
      return n;
    },
    now: () => NOW,
    schedule: () => {},
    log: quiet,
  };
  return { deps, outbox, push, users, devices, counters };
}

const order = pushContent.orderNew({ storeId: 's1', orderId: 'o1', orderNumber: 'MZ-1001', total: 2500 });
const flush = (w: ReturnType<typeof world>, now: Date = NOW) => flushOutbox(w.outbox.model, { push: w.push.channel, provider: createLogProvider(), now: () => now, log: quiet });

test('the role table: a new order reaches the owner, manager and staff, never support; tickets reach support; admin money reaches finance, tickets customer support', async () => {
  assert.deepEqual([...PUSH_ROLE_TABLE.order_new], ['owner', 'manager', 'staff']);
  assert.deepEqual([...PUSH_ROLE_TABLE.subscription_payment], ['owner']);
  assert.ok(PUSH_ROLE_TABLE.support_reply.includes('support'));
  for (const kind of SELLER_PUSH_KINDS) assert.equal(PUSH_ROLE_TABLE[kind].includes('support'), kind === 'support_reply', kind);
  assert.deepEqual([...PUSH_ROLE_TABLE.payment_claim], ['owner', 'finance']);
  assert.deepEqual([...PUSH_ROLE_TABLE.ticket_new], ['owner', 'customer_support']);
  assert.deepEqual([...PUSH_ROLE_TABLE.sync_failure], ['owner', 'operations']);
  assert.equal(ADMIN_PUSH_KINDS.length, 3);

  const w = world();
  assert.deepEqual(await storeRecipients(w.deps.models, 's1', 'order_new'), ['owner', 'manager']);
  assert.deepEqual(await storeRecipients(w.deps.models, 'nope', 'order_new'), []);

  const admins = world({
    users: [
      { _id: 'a-old', role: 'admin', accountStatus: null },
      { _id: 'a-fin', role: 'admin', accountStatus: 'active', adminLevel: 'finance' },
      { _id: 'a-sup', role: 'admin', accountStatus: 'active', adminLevel: 'customer_support' },
      { _id: 'a-off', role: 'admin', accountStatus: 'suspended', adminLevel: 'finance' },
      { _id: 'a-odd', role: 'admin', accountStatus: 'active', adminLevel: 'superuser' },
    ],
  });
  assert.deepEqual(await adminRecipients(admins.deps.models, 'payment_claim'), ['a-old', 'a-fin']);
  assert.deepEqual(await adminRecipients(admins.deps.models, 'ticket_new'), ['a-old', 'a-sup']);
});

test('what a push says: a title and one line with the order number and amount only, and ids to open the screen', () => {
  assert.deepEqual(order, { title: 'New order', body: 'Order MZ-1001 - Rs. 2,500', data: { screen: 'order', storeId: 's1', orderId: 'o1' } });
  const hostile = pushContent.orderNew({ storeId: 's1', orderId: 'o1', orderNumber: 'ayesha@example.com 0300-1234567', total: 1 });
  assert.equal(hostile.body, 'An order - Rs. 1', 'anything that is not an order number is left out');
  const all = [
    order,
    pushContent.orderCancelled({ storeId: 's1', orderId: 'o1', orderNumber: 'MZ-1', total: 10 }),
    pushContent.lowStock({ storeId: 's1', quantity: 3 }),
    pushContent.lowStock({ storeId: 's1', quantity: 0 }),
    pushContent.subscriptionPayment({ confirmed: false, amount: 2500 }),
    pushContent.supportReply({ ticketId: 't1' }),
    pushContent.paymentClaim({ paymentId: 'p1', amount: 2500 }),
    pushContent.ticketNew({ ticketId: 't1' }),
    pushContent.syncFailure({ count: 2 }),
  ];
  for (const c of all) {
    assert.ok(c.title.length <= 40 && c.body.length <= 80, c.body);
    assert.equal(/@|\+92|03\d{2}/.test(c.title + c.body + JSON.stringify(c.data)), false, c.body);
  }
});

test('one event: one row per live phone, sent through the channel, told once however often it is raised', async () => {
  const w = world();
  const send = () => sendPushEvent(w.deps, { app: 'seller', kind: 'order_new', userIds: ['owner', 'manager'], eventKey: 'order_new:o1', content: order, store: 's1' });
  assert.deepEqual(await send(), { queued: 2, muted: 0, duplicate: 0, overQuota: 0 });
  assert.deepEqual(await send(), { queued: 0, muted: 0, duplicate: 2, overQuota: 0 });
  assert.equal(w.outbox.rows.length, 2);
  assert.deepEqual(w.outbox.rows.map((r) => [r.channel, r.template, r.status]), [['push', 'push_order_new', 'queued'], ['push', 'push_order_new', 'queued']]);
  const summary = await flush(w);
  assert.deepEqual([summary.picked, summary.sent], [2, 2]);
  assert.deepEqual(w.push.sent[0], { to: TOKEN, title: 'New order', body: 'Order MZ-1001 - Rs. 2,500', data: order.data });
  assert.equal((await flush(w)).picked, 0, 'a sent row is never sent again');
});

test('phones that are signed out, expired, from before a password change, or without a token get nothing', async () => {
  const base = { app: 'seller', user: 'owner', revokedAt: null, refreshExpiresAt: new Date(NOW.getTime() + 1000), tokenVersion: 0 };
  const w = world({
    devices: [
      { _id: 'x1', ...base, pushToken: TOKEN, revokedAt: new Date() },
      { _id: 'x2', ...base, pushToken: TOKEN, refreshExpiresAt: new Date(NOW.getTime() - 1) },
      { _id: 'x3', ...base, pushToken: TOKEN, tokenVersion: 7 },
      { _id: 'x4', ...base, pushToken: null },
      { _id: 'x5', ...base, pushToken: TOKEN, app: 'admin' },
    ],
  });
  assert.equal((await sendPushEvent(w.deps, { app: 'seller', kind: 'order_new', userIds: ['owner'], eventKey: 'e', content: order })).queued, 0);
});

test('mute: everything, or one kind; and a suspended user gets nothing', async () => {
  const w = world({
    users: [
      { _id: 'owner', accountStatus: 'active', tokenVersion: 0, pushPrefs: { muted: true } },
      { _id: 'manager', accountStatus: 'active', tokenVersion: 0, pushPrefs: { muted: false, mutedKinds: ['low_stock'] } },
      { _id: 'helper', accountStatus: 'suspended', tokenVersion: 0 },
    ],
  });
  const send = (kind: 'order_new' | 'low_stock') => sendPushEvent(w.deps, { app: 'seller', kind, userIds: ['owner', 'manager', 'helper'], eventKey: kind, content: order });
  assert.deepEqual(await send('low_stock'), { queued: 0, muted: 2, duplicate: 0, overQuota: 0 });
  assert.deepEqual(await send('order_new'), { queued: 1, muted: 1, duplicate: 0, overQuota: 0 });
});

test('quiet hours are Pakistan time, may cross midnight, and drop a push without using the quota', async () => {
  const prefs = { muted: false, mutedKinds: [], quietHours: { start: '22:00', end: '07:30' } };
  // 17:00 UTC is 22:00 in Pakistan; 02:30 UTC is 07:30.
  assert.equal(isQuietTime(prefs, new Date('2026-11-26T16:59:00Z')), false);
  assert.equal(isQuietTime(prefs, new Date('2026-11-26T17:00:00Z')), true);
  assert.equal(isQuietTime(prefs, new Date('2026-11-26T02:29:00Z')), true);
  assert.equal(isQuietTime(prefs, new Date('2026-11-26T02:30:00Z')), false);
  assert.equal(isQuietTime({ muted: false, mutedKinds: [], quietHours: { start: '09:00', end: '10:00' } }, new Date('2026-11-26T04:30:00Z')), true);
  assert.equal(isQuietTime({ muted: false, mutedKinds: [] }, new Date()), false);
  assert.deepEqual(readPushPrefs({ muted: false, mutedKinds: [], quietHours: { start: '25:00', end: '07:00' } }), { muted: false, mutedKinds: [] });
  assert.deepEqual(readPushPrefs({ quietHours: null }), { muted: false, mutedKinds: [] });

  const w = world({ users: [{ _id: 'owner', accountStatus: 'active', tokenVersion: 0, pushPrefs: { quietHours: { start: '00:00', end: '23:59' } } }] });
  assert.deepEqual(await sendPushEvent(w.deps, { app: 'seller', kind: 'order_new', userIds: ['owner'], eventKey: 'q', content: order }), { queued: 0, muted: 1, duplicate: 0, overQuota: 0 });
  assert.equal(w.counters.size, 0);
});

test('the daily quota is per user and per day, whatever the number of phones', async () => {
  const w = world();
  for (let i = 0; i < PUSH_DAILY_QUOTA; i += 1) {
    assert.equal((await sendPushEvent(w.deps, { app: 'seller', kind: 'order_new', userIds: ['owner'], eventKey: 'e' + i, content: order })).queued, 1);
  }
  assert.deepEqual(await sendPushEvent(w.deps, { app: 'seller', kind: 'order_new', userIds: ['owner'], eventKey: 'one-more', content: order }), { queued: 0, muted: 0, duplicate: 0, overQuota: 1 });
  assert.equal((await sendPushEvent(w.deps, { app: 'seller', kind: 'order_new', userIds: ['manager'], eventKey: 'one-more', content: order })).queued, 1, 'another user has their own quota');
  w.deps.now = () => new Date(NOW.getTime() + 86_400_000);
  w.devices.forEach((d) => (d.refreshExpiresAt = new Date(NOW.getTime() + 3 * 86_400_000)));
  assert.equal((await sendPushEvent(w.deps, { app: 'seller', kind: 'order_new', userIds: ['owner'], eventKey: 'next-day', content: order })).queued, 1);
});

test('a retryable failure waits and is sent later; a dead token is removed and never retried', async () => {
  const w = world();
  w.push.channel.client = fakePush().channel.client;
  const retry = fakePush([{ ok: false, error: 'EXPO_HTTP_503', retryable: true }]);
  w.deps.channel = retry.channel;
  await enqueuePush(w.outbox.model, { to: TOKEN, title: 't', body: 'b', data: {}, app: 'seller', kind: 'order_new', dedupeKey: 'k1' }, { push: retry.channel, sendNow: false, now: () => NOW });
  const first = await flushOutbox(w.outbox.model, { push: retry.channel, provider: createLogProvider(), now: () => NOW, log: quiet });
  assert.equal(first.retry, 1);
  const later = await flushOutbox(w.outbox.model, { push: retry.channel, provider: createLogProvider(), now: () => new Date(NOW.getTime() + 3 * 60_000), log: quiet });
  assert.equal(later.sent, 1);

  const logged: unknown[] = [];
  const dead = fakePush([{ ok: false, error: 'EXPO_DeviceNotRegistered ' + TOKEN2, retryable: false, deadToken: true }]);
  await enqueuePush(w.outbox.model, { to: TOKEN2, title: 't', body: 'b', data: {}, app: 'seller', kind: 'order_new', dedupeKey: 'k2' }, { push: dead.channel, sendNow: false, now: () => NOW });
  const gone = await flushOutbox(w.outbox.model, { push: dead.channel, provider: createLogProvider(), now: () => NOW, log: (...args) => void logged.push(args) });
  assert.equal(gone.failed, 1);
  assert.deepEqual(dead.dead, [TOKEN2]);
  const row = w.outbox.rows.find((r) => r.dedupeKey === 'k2')!;
  assert.deepEqual([row.status, row.nextAttemptAt], ['failed', null]);
  assert.equal((JSON.stringify(logged) + row.lastError).includes(TOKEN2), false, 'no token in a log or in the stored error');
});

test('a flush without a push channel leaves push rows exactly as they are', async () => {
  const w = world();
  await enqueuePush(w.outbox.model, { to: TOKEN, title: 't', body: 'b', data: {}, app: 'seller', kind: 'order_new', dedupeKey: 'k' }, { push: w.push.channel, sendNow: false, now: () => NOW });
  const summary = await flushOutbox(w.outbox.model, { provider: createLogProvider(), now: () => NOW, log: quiet });
  assert.equal(summary.picked, 0);
  assert.deepEqual([w.outbox.rows[0]!.status, w.outbox.rows[0]!.attempts], ['queued', 0]);
});

test('sending an event never throws', async () => {
  const w = world();
  w.deps.models.devices.find = () => {
    throw new Error('database down');
  };
  assert.deepEqual(await sendPushEvent(w.deps, { app: 'seller', kind: 'order_new', userIds: ['owner'], eventKey: 'x', content: order }), { queued: 0, muted: 0, duplicate: 0, overQuota: 0 });
});

test('the Expo client: the request, the optional access token, and how each answer is read (no network)', async () => {
  const calls: Array<{ url: string; init: any }> = [];
  const answer = (status: number, body: unknown) => async (url: string, init: any) => {
    calls.push({ url, init });
    return { ok: status < 300, status, json: async () => body };
  };
  const message = { to: TOKEN, title: 'T', body: 'B', data: { screen: 'sync' } };
  assert.deepEqual(await createExpoPushClient({ fetchImpl: answer(200, { data: { status: 'ok', id: 'r1' } }) }).send(message), { ok: true, ticketId: 'r1' });
  assert.equal(calls[0]!.url, EXPO_PUSH_URL);
  assert.equal(calls[0]!.init.headers.authorization, undefined);
  assert.deepEqual(JSON.parse(calls[0]!.init.body), { to: TOKEN, title: 'T', body: 'B', data: { screen: 'sync' }, sound: 'default' });
  await createExpoPushClient({ accessToken: 'secret-token', fetchImpl: answer(200, { data: [{ status: 'ok', id: 'r2' }] }) }).send(message);
  assert.equal(calls[1]!.init.headers.authorization, 'Bearer secret-token');

  const dead = await createExpoPushClient({ fetchImpl: answer(200, { data: { status: 'error', message: '"' + TOKEN + '" is not registered', details: { error: 'DeviceNotRegistered' } } }) }).send(message);
  assert.deepEqual(dead, { ok: false, error: 'EXPO_DeviceNotRegistered', retryable: false, deadToken: true });
  assert.deepEqual(await createExpoPushClient({ fetchImpl: answer(429, {}) }).send(message), { ok: false, error: 'EXPO_HTTP_429', retryable: true });
  assert.deepEqual(await createExpoPushClient({ fetchImpl: answer(400, {}) }).send(message), { ok: false, error: 'EXPO_HTTP_400', retryable: false });
  const down = await createExpoPushClient({
    fetchImpl: async () => {
      throw new Error('fetch failed for ' + TOKEN);
    },
  }).send(message);
  assert.equal(down.ok, false);
  assert.equal(JSON.stringify(down).includes(TOKEN), false);

  assert.ok(isExpoPushToken(TOKEN));
  for (const bad of ['', 'abc', 'ExponentPushToken[]', 'ExponentPushToken[<script>]', 5]) assert.equal(isExpoPushToken(bad), false, String(bad));
});
