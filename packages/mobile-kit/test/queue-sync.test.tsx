import { onlineManager } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { createMobileRuntime } from '../src/core/runtime';
import { memoryStore } from '../src/core/storage';
import { FIRST_SEND_DELAY_MS, RETRY_EVERY_MS, useQueuedChanges, useQueueSync } from '../src/native/queue-sync';
import { BASE, fakeServer, signInAnswer } from './fake-server';

const STORE = 's1';
const note = (label: string) => ({ storeId: STORE, change: { kind: 'order.note' as const, orderId: 'o1', text: label }, revision: 1, label });

async function signedIn(reply: () => 'offline' | { body: unknown }) {
  const server = fakeServer((request) => (request.path.endsWith('/auth/login') ? { body: signInAnswer() } : reply()));
  let n = 0;
  const runtime = createMobileRuntime({
    app: 'seller',
    baseUrl: BASE,
    appVersion: '1.0.0',
    secrets: memoryStore(),
    storage: memoryStore(),
    random: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    fetch: server.fetch,
  });
  await runtime.session.signIn({});
  const sent = () => server.seen.filter((request) => request.path.endsWith('/notes'));
  return { runtime, sent };
}

describe('sending the queue', () => {
  afterEach(() => {
    jest.useRealTimers();
    onlineManager.setOnline(true);
  });

  it('waits while offline and sends when the network returns', async () => {
    onlineManager.setOnline(false);
    const t = await signedIn(() => ({ body: { order: { revision: 2 } } }));
    await t.runtime.queue()!.enqueue(note('a'));
    const hook = await renderHook(() => {
      useQueueSync(t.runtime);
      return useQueuedChanges(t.runtime);
    });
    expect(hook.result.current).toHaveLength(1);
    expect(t.sent()).toHaveLength(0);
    await act(async () => onlineManager.setOnline(true));
    await waitFor(() => expect(hook.result.current).toHaveLength(0));
    expect(t.sent()).toHaveLength(1);
    await hook.unmount();
  });

  it('sends after start, and again later while the server cannot be reached', async () => {
    jest.useFakeTimers();
    let down = true;
    const t = await signedIn(() => (down ? 'offline' : { body: { order: { revision: 2 } } }));
    await t.runtime.queue()!.enqueue(note('b'));
    const hook = await renderHook(() => useQueueSync(t.runtime));
    expect(t.sent()).toHaveLength(0);
    await act(async () => jest.advanceTimersByTimeAsync(FIRST_SEND_DELAY_MS));
    expect(t.sent()).toHaveLength(1);
    down = false;
    await act(async () => jest.advanceTimersByTimeAsync(RETRY_EVERY_MS));
    expect(t.sent()).toHaveLength(2);
    expect(t.runtime.queue()!.list()).toHaveLength(0);
    await hook.unmount();
  });

  it('keeps the key of a request that was already sent', async () => {
    const t = await signedIn(() => ({ body: { order: { revision: 2 } } }));
    const item = await t.runtime.queue()!.enqueue({ ...note('c'), idempotencyKey: 'already-sent-key' });
    expect(item).toMatchObject({ idempotencyKey: 'already-sent-key', attempted: true, state: 'pending' });
    await t.runtime.queue()!.flush();
    expect(t.sent()[0]!.headers['idempotency-key']).toBe('already-sent-key');
  });
});
