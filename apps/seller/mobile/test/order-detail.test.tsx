import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { OrderDetailScreen } from '../src/screens/order-detail';
import { ORDER, orderDetail, setup, type Seen } from './harness';

const reading = (over: object = {}) => (r: Seen) => (r.path.endsWith(`/orders/${ORDER}`) ? { body: orderDetail(over) } : undefined);

describe('order detail', () => {
  it('shows items, the tax line, the total, the customer and the timeline', async () => {
    const app = await setup({ handler: reading() });
    await app.show(<OrderDetailScreen orderId={ORDER} />);
    expect(await screen.findByText('2 x Shawl')).toBeTruthy();
    expect(screen.getByText('GST 17%')).toBeTruthy();
    expect(screen.getByText('Rs 400')).toBeTruthy();
    expect(screen.getByText('Rs 3,000')).toBeTruthy();
    expect(screen.getByText('Ayesha')).toBeTruthy();
    expect(screen.getByText('Order placed')).toBeTruthy();
  });

  it('confirms an order with the revision seen and a key, and shows the new status', async () => {
    const app = await setup({
      handler: (r) =>
        r.method === 'POST' && r.path.endsWith('/status')
          ? { body: { changed: true, order: orderDetail({ status: 'confirmed', revision: 200, allowedNext: ['processing'] }) } }
          : reading()(r),
    });
    await app.show(<OrderDetailScreen orderId={ORDER} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Confirm order' }));
    // S9-UI: every status change is confirmed on a sheet first.
    await fireEvent.press(screen.getByRole('button', { name: 'Yes, confirm order' }));
    expect(await screen.findByRole('button', { name: 'Start processing' })).toBeTruthy();
    const sent = app.requests('/status', 'POST')[0]!;
    expect(sent.body).toEqual({ revision: 100, status: 'confirmed' });
    expect(sent.headers['idempotency-key']).toBeTruthy();
  });

  it('asks on a sheet before a status change, and Not now sends nothing', async () => {
    const app = await setup({ handler: reading() });
    await app.show(<OrderDetailScreen orderId={ORDER} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Confirm order' }));
    expect(screen.getByText('Confirm order?')).toBeTruthy();
    expect(screen.getByText('ORD-1001 goes from Pending to Confirmed.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByText('Confirm order?')).toBeNull();
    expect(app.requests('/status', 'POST')).toHaveLength(0);
  });

  it('asks for the courier and tracking number before a dispatch', async () => {
    const app = await setup({
      handler: (r) =>
        r.method === 'POST' ? { body: { changed: true, order: orderDetail({ status: 'dispatched', allowedNext: ['delivered'] }) } } : reading({ status: 'processing', allowedNext: ['dispatched'] })(r),
    });
    await app.show(<OrderDetailScreen orderId={ORDER} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Dispatch order' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm dispatch' }));
    expect(screen.getByText('Enter the courier and the tracking number.')).toBeTruthy();
    expect(app.requests('/status', 'POST')).toHaveLength(0);
    await fireEvent.press(screen.getByRole('button', { name: 'TCS' }));
    await fireEvent.changeText(screen.getByLabelText('Tracking number'), 'T123');
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm dispatch' }));
    await screen.findByRole('button', { name: 'Mark delivered' });
    expect(app.requests('/status', 'POST')[0]!.body).toEqual({ revision: 100, status: 'dispatched', courier: 'TCS', trackingNumber: 'T123' });
  });

  it('queues a change that got no answer as the very same request, so it cannot be made twice', async () => {
    let down = true;
    const app = await setup({
      handler: (r) => (r.method === 'POST' ? (down ? 'offline' : { body: { changed: true, order: orderDetail({ status: 'confirmed', allowedNext: [] }) } }) : reading()(r)),
    });
    await app.show(<OrderDetailScreen orderId={ORDER} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Confirm order' }));
    // S9-UI: every status change is confirmed on a sheet first.
    await fireEvent.press(screen.getByRole('button', { name: 'Yes, confirm order' }));
    expect(await screen.findByText(/Saved on this phone/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm order' })).toBeNull();
    down = false;
    await app.runtime.queue()!.flush();
    const [first, second] = app.requests('/status', 'POST');
    expect(second!.headers['idempotency-key']).toBe(first!.headers['idempotency-key']);
    expect(second!.body).toEqual(first!.body);
  });

  it('shows the server version after a conflict instead of overwriting it', async () => {
    const app = await setup({
      handler: (r) =>
        r.method === 'POST'
          ? { status: 409, body: { code: 'CONFLICT', errors: [{ message: 'changed' }], current: orderDetail({ status: 'cancelled', revision: 300, allowedNext: [] }) } }
          : reading()(r),
    });
    await app.show(<OrderDetailScreen orderId={ORDER} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Confirm order' }));
    // S9-UI: every status change is confirmed on a sheet first.
    await fireEvent.press(screen.getByRole('button', { name: 'Yes, confirm order' }));
    expect(await screen.findByText(/changed on the server/)).toBeTruthy();
    expect(screen.getByText('Cancelled')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm order' })).toBeNull();
  });

  it('is read-only for support, which can still add a note', async () => {
    const app = await setup({
      role: 'support',
      handler: (r) =>
        r.method === 'POST' ? { body: { order: orderDetail({ revision: 200, notes: [{ id: 'n1', text: 'Called', by: null, at: '2026-11-20T11:00:00.000Z' }] }) } } : reading()(r),
    });
    await app.show(<OrderDetailScreen orderId={ORDER} />);
    expect(await screen.findByText('Your role can view this order and add notes, not change its status.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm order' })).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('New note (only your team sees it)'), '  Called  ');
    await fireEvent.press(screen.getByRole('button', { name: 'Add note' }));
    expect(await screen.findByText('Called')).toBeTruthy();
    await waitFor(() => expect(app.requests('/notes', 'POST')[0]!.body).toEqual({ revision: 100, text: 'Called' }));
  });
});
