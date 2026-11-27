import { useQueueSync } from '@markaz/mobile-kit';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { markFirstScreen, resetStartupClock, startupMillis } from '../src/perf';
import { NotificationSettingsScreen } from '../src/screens/notification-settings';
import { OrderDetailScreen } from '../src/screens/order-detail';
import { OrdersScreen } from '../src/screens/orders';
import { describeMine, describeServer, PendingScreen } from '../src/screens/pending';
import { ProductDetailScreen } from '../src/screens/product-detail';
import { useServices } from '../src/services';
import { ORDER, orderDetail, orderItem, orderPage, setup, STORE, type Seen } from './harness';

jest.mock('expo-image', () => ({ Image: () => null }));

const PRODUCT = '65d000000000000000000001';
const VARIANT = '65e000000000000000000001';
const STAMP = { revision: 100, updatedAt: '2026-11-20T10:00:00.000Z' };
const product = (over: object = {}, stock = 10) => ({
  id: PRODUCT,
  title: 'Shawl',
  status: 'published',
  minPrice: 1500,
  totalStock: stock,
  stockStatus: 'in_stock',
  variantCount: 1,
  imageUrl: null,
  description: null,
  variants: [{ id: VARIANT, title: 'Default', sku: null, price: 1500, compareAtPrice: null, trackQuantity: true, stockQuantity: stock, availability: 'in_stock', ...STAMP }],
  media: [],
  ...STAMP,
  ...over,
});

const goOffline = () => act(async () => onlineManager.setOnline(false));
const goOnline = () => act(async () => onlineManager.setOnline(true));
afterEach(() => onlineManager.setOnline(true));

function Sync() {
  useQueueSync(useServices().runtime);
  return null;
}

const server = (r: Seen) => {
  if (r.method === 'GET' && r.path.endsWith(`/orders/${ORDER}`)) return { body: orderDetail() };
  if (r.method === 'GET' && r.path.endsWith('/orders')) return { body: orderPage([orderItem(1, { id: ORDER })]) };
  if (r.method === 'GET' && r.path.endsWith(`/products/${PRODUCT}`)) return { body: product() };
  if (r.path.endsWith('/status')) return { body: { changed: true, order: orderDetail({ status: 'confirmed', revision: 200, allowedNext: ['processing'] }) } };
  if (r.path.endsWith('/notes')) return { body: { order: orderDetail({ revision: 300 }) } };
  if (r.path.endsWith('/stock')) return { body: { changed: true, product: product({}, 7) } };
  return undefined;
};

describe('offline reading', () => {
  it('says there is no connection on a screen never opened before', async () => {
    const app = await setup({ handler: server });
    onlineManager.setOnline(false);
    await app.show(<OrderDetailScreen orderId={ORDER} />);
    expect(await screen.findByText('No connection')).toBeTruthy();
    expect(app.requests(`/orders/${ORDER}`)).toHaveLength(0);
  });

  it('shows a screen opened before from the cache, with the offline banner and the time', async () => {
    const app = await setup({ handler: server });
    const view = await app.show(<OrdersScreen onOpenOrder={() => undefined} />);
    expect(await screen.findByLabelText('Order ORD-1001, Pending, Rs 2,500')).toBeTruthy();
    await view.unmount();
    onlineManager.setOnline(false);
    await app.show(<OrdersScreen onOpenOrder={() => undefined} />);
    expect(await screen.findByLabelText('Order ORD-1001, Pending, Rs 2,500')).toBeTruthy();
    expect(screen.getByText(/^Offline\. Last refreshed .+\.$/)).toBeTruthy();
  });
});

describe('offline changing', () => {
  it('queues a status change and a note, marks them, and sends each once in order when the network returns', async () => {
    const app = await setup({ handler: server });
    await app.show(
      <>
        <Sync />
        <OrderDetailScreen orderId={ORDER} />
      </>,
    );
    await screen.findByRole('button', { name: 'Confirm order' });
    await goOffline();
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm order' }));
    expect(await screen.findByText('Set the status to Confirmed')).toBeTruthy();
    expect(screen.getByText('A status change is waiting to be sent. The next one can be made after it.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('New note (only your team sees it)'), 'Call first');
    await fireEvent.press(screen.getByRole('button', { name: 'Add note' }));
    expect(await screen.findByText('Add the note "Call first"')).toBeTruthy();
    expect(app.seen.filter((r) => r.method === 'POST')).toHaveLength(0);

    await goOnline();
    await waitFor(() => expect(app.runtime.queue()!.list()).toHaveLength(0));
    const sent = app.seen.filter((r) => r.method === 'POST');
    expect(sent.map((r) => r.path.split('/').at(-1))).toEqual(['status', 'notes']);
    // The note was written on top of the status change: it carries the revision that change produced.
    expect([sent[0]!.body.revision, sent[1]!.body.revision]).toEqual([100, 200]);
  });

  it('queues a stock count; a price waits for the network', async () => {
    const app = await setup({ handler: server });
    await app.show(<ProductDetailScreen productId={PRODUCT} />);
    await screen.findByRole('button', { name: 'Count stock: Shawl' });
    await goOffline();
    expect(screen.getByText('Changing a price needs a connection.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change price: Shawl' }).props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByRole('button', { name: 'Count stock: Shawl' }));
    await fireEvent.changeText(screen.getByLabelText('Count on the shelf now'), '7');
    await fireEvent.press(screen.getByRole('button', { name: 'Save count' }));
    expect(await screen.findByText('Waiting to be sent: Set the stock to 7.')).toBeTruthy();
    expect(app.requests('/stock', 'POST')).toHaveLength(0);
    expect(app.runtime.queue()!.list()[0]).toMatchObject({ revision: 100, change: { kind: 'stock.count', quantity: 7 }, seen: { quantity: 10 } });
  });

  it('keeps the settings that need the server switched off', async () => {
    const app = await setup({ handler: (r) => (r.path.endsWith('/push-settings') ? { body: { muted: false, mutedKinds: [], kinds: ['order_new'] } } : undefined) });
    await app.show(<NotificationSettingsScreen />);
    await screen.findByLabelText('New orders');
    await goOffline();
    expect(screen.getByText('Changing notification settings needs a connection.')).toBeTruthy();
    expect(screen.getByLabelText('Mute all notifications')).toBeDisabled();
  });
});

describe('pending changes screen', () => {
  const queueUp = async (app: Awaited<ReturnType<typeof setup>>) => {
    const queue = app.runtime.queue()!;
    await queue.enqueue({ storeId: STORE, change: { kind: 'order.status', orderId: ORDER, status: 'confirmed' }, revision: 100, label: 'ORD-1001: Confirm order' });
    await queue.enqueue({ storeId: STORE, change: { kind: 'stock.count', productId: PRODUCT, variantId: VARIANT, quantity: 7 }, revision: 100, label: 'Shawl: stock count' });
    return queue;
  };

  it('shows both values of a conflict and does what the seller chooses', async () => {
    let conflicts = 1;
    const app = await setup({
      handler: (r) =>
        r.path.endsWith('/status') && conflicts-- > 0
          ? { status: 409, body: { code: 'CONFLICT', errors: [{ message: 'changed' }], current: orderDetail({ status: 'cancelled', revision: 900 }) } }
          : server(r),
    });
    const queue = await queueUp(app);
    await app.show(<PendingScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Send now' }));
    expect(await screen.findByText('The server now has the status Cancelled. Which one wins?')).toBeTruthy();
    expect(screen.getByText('Yours: Set the status to Confirmed')).toBeTruthy();
    expect(app.requests('/stock', 'POST')).toHaveLength(0);

    await fireEvent.press(screen.getByRole('button', { name: 'Send mine anyway' }));
    await waitFor(() => expect(queue.list()).toHaveLength(0));
    const [first, second] = app.requests('/status', 'POST');
    expect(second!.body.revision).toBe(900);
    expect(second!.headers['idempotency-key']).not.toBe(first!.headers['idempotency-key']);
    expect(await screen.findByText('Nothing is waiting')).toBeTruthy();
  });

  it('"keep the server value" drops the change; a refused change can be discarded', async () => {
    const app = await setup({
      handler: (r) =>
        r.path.endsWith('/status')
          ? { status: 409, body: { code: 'CONFLICT', errors: [{ message: 'changed' }], current: orderDetail({ status: 'cancelled' }) } }
          : r.path.endsWith('/stock')
            ? { status: 422, body: { errors: [{ message: 'This variant is not counted.', code: 'VARIANT_NOT_TRACKED' }] } }
            : undefined,
    });
    const queue = await queueUp(app);
    await queue.flush();
    await app.show(<PendingScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: "Keep the server's value" }));
    await waitFor(() => expect(queue.list()).toHaveLength(1));
    await fireEvent.press(screen.getByRole('button', { name: 'Send now' }));
    expect(await screen.findByText('This variant is not counted.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(queue.list()).toHaveLength(0));
  });

  it('describes each kind of change and the server value', () => {
    const base = { id: 'k', storeId: STORE, revision: 1, idempotencyKey: 'k', createdAt: '', state: 'conflict' as const, attempted: true, label: '' };
    const count = { ...base, change: { kind: 'stock.count' as const, productId: PRODUCT, variantId: VARIANT, quantity: 3 }, current: product({}, 9) };
    expect([describeMine(count), describeServer(count)]).toEqual(['Set the stock to 3', 'The server now has 9 in stock']);
    expect(describeMine({ ...base, change: { kind: 'order.status', orderId: ORDER, status: 'dispatched', courier: 'TCS', trackingNumber: 'T1' } })).toBe(
      'Set the status to Dispatched, TCS T1',
    );
  });
});

describe('start time', () => {
  it('is measured once, to the first screen with data', () => {
    resetStartupClock(1000);
    expect(startupMillis()).toBeNull();
    markFirstScreen(2500);
    markFirstScreen(9000);
    expect(startupMillis()).toBe(1500);
  });
});
