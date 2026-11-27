import { createApiClient } from '../src/core/api-client';
import { queueStorageKey } from '../src/core/offline/cache';
import { createOfflineQueue, requestFor, type OfflineChange } from '../src/core/offline/queue';
import { memoryStore } from '../src/core/storage';
import { BASE, fakeServer, sellerError, type Handler, type Reply } from './fake-server';

const confirm: OfflineChange = { kind: 'order.status', orderId: 'o1', status: 'confirmed' };
const ship: OfflineChange = { kind: 'order.status', orderId: 'o1', status: 'shipped', courier: 'TCS', trackingNumber: 'T1' };
const note: OfflineChange = { kind: 'order.note', orderId: 'o2', text: 'Call after 5' };
const count: OfflineChange = { kind: 'stock.count', productId: 'p1', variantId: 'v1', quantity: 7 };

const add = (change: OfflineChange, revision = 100) => ({ storeId: 's1', change, revision, label: change.kind });
const orderAt = (revision: number) => ({ body: { changed: true, order: { revision } } });

function setup(handler: Handler, storage = memoryStore()) {
  const server = fakeServer(handler);
  const client = createApiClient({ baseUrl: BASE, appVersion: '1.0.0', fetch: server.fetch, tokens: { accessToken: async () => 'a', refresh: async () => null } });
  let n = 0;
  const queue = createOfflineQueue({ userId: 'u1', storage, client, newKey: () => `key-0000000${++n}`, now: () => new Date('2026-11-26T10:00:00Z') });
  return { queue, server, storage, client };
}

describe('offline queue', () => {
  it('builds the three writes of the mobile API with the key and the revision', () => {
    const base = { id: 'k', storeId: 's1', revision: 9, idempotencyKey: 'key-00000001', createdAt: '', state: 'pending' as const, attempted: false, label: '' };
    expect(requestFor({ ...base, change: ship })).toMatchObject({
      method: 'POST',
      path: '/api/mobile/v1/orders/o1/status',
      storeId: 's1',
      idempotencyKey: 'key-00000001',
      body: { revision: 9, status: 'shipped', courier: 'TCS', trackingNumber: 'T1' },
    });
    expect(requestFor({ ...base, change: note })).toMatchObject({ path: '/api/mobile/v1/orders/o2/notes', body: { revision: 9, text: 'Call after 5' } });
    expect(requestFor({ ...base, change: count })).toMatchObject({ path: '/api/mobile/v1/products/p1/stock', body: { revision: 9, variantId: 'v1', quantity: 7 } });
  });

  it('sends in the order made, one at a time, and empties the stored queue', async () => {
    const t = setup((request) => (request.path.includes('products') ? { body: { changed: true, product: { revision: 300 } } } : orderAt(200)));
    await t.queue.enqueue(add(note));
    await t.queue.enqueue(add(count));
    await t.queue.enqueue(add(confirm));
    const result = await t.queue.flush();
    expect(result.stopped).toBeNull();
    expect(result.sent).toHaveLength(3);
    expect(t.server.seen.map((request) => request.path)).toEqual(['/api/mobile/v1/orders/o2/notes', '/api/mobile/v1/products/p1/stock', '/api/mobile/v1/orders/o1/status']);
    expect(t.storage.data.has(queueStorageKey('u1'))).toBe(false);
  });

  it('keeps the queue through a killed app and resends the very same request', async () => {
    const storage = memoryStore();
    const first = setup(() => 'offline', storage);
    await first.queue.enqueue(add(confirm));
    expect((await first.queue.flush()).stopped).toBe('offline');

    const second = setup(() => orderAt(200), storage);
    await second.queue.load();
    expect(second.queue.list()).toHaveLength(1);
    await second.queue.flush();
    expect(second.server.seen[0]!.headers['idempotency-key']).toBe(first.server.seen[0]!.headers['idempotency-key']);
    expect(second.server.seen[0]!.body).toEqual(first.server.seen[0]!.body);
  });

  it('moves a later change of the same record to the new revision, so a user does not conflict with themself', async () => {
    const answers: Reply[] = [orderAt(200), orderAt(250), orderAt(300)];
    const t = setup(() => answers.shift()!);
    await t.queue.enqueue(add(confirm, 100));
    await t.queue.enqueue(add(note, 100));
    await t.queue.enqueue(add(ship, 100));
    await t.queue.flush();
    expect(t.server.seen.map((request) => request.body.revision)).toEqual([100, 100, 200]);
  });

  it('does not move the revision when nothing was written', async () => {
    const answers: Reply[] = [{ body: { changed: false, order: { revision: 500 } } }, sellerError(409, 'moved', 'CONFLICT')];
    const t = setup(() => answers.shift()!);
    await t.queue.enqueue(add(confirm, 100));
    await t.queue.enqueue(add(ship, 100));
    await t.queue.flush();
    expect(t.server.seen[1]!.body.revision).toBe(100);
  });

  it('stops on a conflict and keeps both values; nothing after it is sent', async () => {
    const current = { revision: 999, status: 'cancelled' };
    const t = setup(() => ({ status: 409, body: { code: 'CONFLICT', errors: [{ message: 'This record changed.' }], current } }));
    await t.queue.enqueue({ ...add(confirm), seen: { status: 'pending', revision: 100 } });
    await t.queue.enqueue(add(count));
    expect((await t.queue.flush()).stopped).toBe('conflict');
    expect(t.server.seen).toHaveLength(1);
    expect(t.queue.list()[0]).toMatchObject({ state: 'conflict', change: confirm, current, seen: { status: 'pending' }, problem: { status: 409, code: 'CONFLICT' } });
    expect(t.queue.list()[1]).toMatchObject({ state: 'pending', attempted: false });
    // Still stopped on the next try: only the user decides.
    expect((await t.queue.flush()).stopped).toBe('conflict');
    expect(t.server.seen).toHaveLength(1);
    expect(JSON.parse(t.storage.data.get(queueStorageKey('u1'))!)).toHaveLength(2);
  });

  it('"mine wins" is a new request on top of the server value', async () => {
    const answers: Reply[] = [{ status: 409, body: { code: 'CONFLICT', current: { revision: 999 } } }, orderAt(1000)];
    const t = setup(() => answers.shift()!);
    const item = await t.queue.enqueue(add(confirm));
    await t.queue.flush();
    await t.queue.keepMine(item.id);
    expect(t.queue.list()[0]).toMatchObject({ state: 'pending', revision: 999 });
    expect((await t.queue.flush()).stopped).toBeNull();
    expect(t.server.seen[1]!.body.revision).toBe(999);
    expect(t.server.seen[1]!.headers['idempotency-key']).not.toBe(t.server.seen[0]!.headers['idempotency-key']);
  });

  it('"server wins" drops the change and the rest goes on', async () => {
    const answers: Reply[] = [{ status: 409, body: { code: 'CONFLICT', current: { revision: 999 } } }, { body: { changed: true, product: { revision: 2 } } }];
    const t = setup(() => answers.shift()!);
    const item = await t.queue.enqueue(add(confirm));
    await t.queue.enqueue(add(count));
    await t.queue.flush();
    await t.queue.discard(item.id);
    expect((await t.queue.flush()).stopped).toBeNull();
    expect(t.queue.list()).toHaveLength(0);
  });

  it('marks a refusal as failed, and a retry uses a new key', async () => {
    const answers: Reply[] = [{ status: 422, body: { errors: [{ message: 'Not tracked', code: 'VARIANT_NOT_TRACKED' }] } }, { body: { changed: true, product: { revision: 2 } } }];
    const t = setup(() => answers.shift()!);
    const item = await t.queue.enqueue(add(count));
    expect((await t.queue.flush()).stopped).toBe('failed');
    expect(t.queue.list()[0]).toMatchObject({ state: 'failed', problem: { status: 422, code: 'VARIANT_NOT_TRACKED' } });
    await t.queue.keepMine(item.id);
    await t.queue.flush();
    expect(t.server.seen[1]!.headers['idempotency-key']).not.toBe(item.idempotencyKey);
  });

  it.each([
    ['busy', sellerError(409, 'running', 'IDEMPOTENCY_IN_PROGRESS')],
    ['server', sellerError(500, 'boom')],
    ['server', sellerError(429, 'slow')],
    ['signed_out', sellerError(401, 'gone')],
    ['upgrade', { status: 426, body: { minVersion: '2.0.0' } }],
    ['offline', 'offline' as const],
  ])('waits and keeps the same key when the answer is %s', async (reason, reply) => {
    const t = setup(() => reply as Reply);
    const item = await t.queue.enqueue(add(confirm));
    expect((await t.queue.flush()).stopped).toBe(reason);
    expect(t.queue.list()[0]).toMatchObject({ state: 'pending', idempotencyKey: item.idempotencyKey, attempted: true });
  });

  it('runs one flush at a time', async () => {
    const t = setup(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return orderAt(200);
    });
    await t.queue.enqueue(add(confirm));
    await Promise.all([t.queue.flush(), t.queue.flush()]);
    expect(t.server.seen).toHaveLength(1);
  });

  it('keeps a change that is added while another is being sent', async () => {
    let queue!: ReturnType<typeof createOfflineQueue>;
    const t = setup(async (request) => {
      if (request.path.includes('o1')) await queue.enqueue(add(note));
      return orderAt(200);
    });
    queue = t.queue;
    await t.queue.enqueue(add(confirm));
    expect((await t.queue.flush()).sent).toHaveLength(2);
  });

  it('is empty after clear, even when an answer arrives later', async () => {
    let queue!: ReturnType<typeof createOfflineQueue>;
    const t = setup(async () => {
      await queue.clear();
      return sellerError(422, 'late');
    });
    queue = t.queue;
    await t.queue.enqueue(add(confirm));
    await t.queue.flush();
    expect(t.queue.list()).toHaveLength(0);
    expect(t.storage.data.size).toBe(0);
  });

  it('starts clean from an unreadable stored queue and tells its listeners about changes', async () => {
    const storage = memoryStore({ [queueStorageKey('u1')]: 'not json' });
    const t = setup(() => orderAt(1), storage);
    let calls = 0;
    const stop = t.queue.subscribe(() => {
      calls += 1;
    });
    await t.queue.load();
    expect(t.queue.list()).toHaveLength(0);
    await t.queue.enqueue(add(confirm));
    expect(calls).toBeGreaterThan(0);
    stop();
  });
});
