import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { DashboardScreen } from '../src/screens/dashboard';
import { OrdersScreen } from '../src/screens/orders';
import { SignInScreen } from '../src/screens/sign-in';
import { StoresScreen } from '../src/screens/stores';
import { selectedStoreKey } from '../src/services';
import { dashboard, orderItem, orderPage, setup, STORE, STORE2, storeRow, type Seen } from './harness';

const nothing = () => undefined;
const dashboardProps = { onOpenOrder: nothing, onOpenOrders: nothing, onSwitchStore: nothing, onOpenLowStock: nothing, onOpenAlerts: nothing, onOpenPending: nothing };

describe('sign in', () => {
  it('checks the email before sending anything', async () => {
    const app = await setup({ signIn: false });
    await app.show(<SignInScreen />);
    await fireEvent.changeText(screen.getByLabelText('Email'), 'not-an-email');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'secret-pass');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
    expect(app.seen).toHaveLength(0);
  });

  it('signs in with the phone named, and shows what the server refuses', async () => {
    let refuse = true;
    const app = await setup({
      signIn: false,
      handler: (r) => (r.path.endsWith('/auth/login') && refuse ? { status: 401, body: { errors: [{ message: 'Wrong email or password' }] } } : undefined),
    });
    await app.show(<SignInScreen />);
    await fireEvent.changeText(screen.getByLabelText('Email'), ' Ayesha@Example.com ');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'secret-pass');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Wrong email or password')).toBeTruthy();
    refuse = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(app.runtime.session.getState().status).toBe('signed_in'));
    expect(app.requests('/auth/login').at(-1)!.body).toMatchObject({ email: 'ayesha@example.com', deviceName: 'Test phone', platform: 'android', appVersion: '1.0.0' });
    expect(app.requests('/auth/login').at(-1)!.body.installationId).toBeTruthy();
  });

  it('says why the last session ended', async () => {
    const app = await setup({ signIn: false });
    await app.show(<SignInScreen endedBecause="revoked" />);
    expect(screen.getByText('This phone was signed out. Sign in again.')).toBeTruthy();
  });
});

const answers =
  (numbers = dashboard()) =>
  (r: Seen) =>
    r.path.endsWith('/dashboard') ? { body: numbers } : r.path.endsWith('/alerts') ? { body: { docs: [], page: 1, limit: 1, totalDocs: 0, totalPages: 0, unread: 5 } } : undefined;

describe('dashboard', () => {
  it('shows the owner sales, pending orders, low stock and unread alerts of the chosen store', async () => {
    const app = await setup({ handler: answers() });
    const onOpenOrders = jest.fn();
    const onOpenLowStock = jest.fn();
    const onOpenAlerts = jest.fn();
    await app.show(<DashboardScreen {...dashboardProps} onOpenOrders={onOpenOrders} onOpenLowStock={onOpenLowStock} onOpenAlerts={onOpenAlerts} />);
    expect(await screen.findByLabelText('Sales today: Rs 1,500')).toBeTruthy();
    expect(screen.getByLabelText('Sales in 7 days: Rs 12,000')).toBeTruthy();
    expect(screen.getByLabelText('Low stock products: 4')).toBeTruthy();
    expect(await screen.findByLabelText('Unread alerts: 5')).toBeTruthy();
    expect(screen.getByLabelText('Delivered this month: Rs 90,000')).toBeTruthy();
    expect(app.requests('/dashboard')[0]!.headers['x-store-id']).toBe(STORE);
    await fireEvent.press(screen.getByLabelText('Pending orders: 2'));
    expect(onOpenOrders).toHaveBeenCalledWith({ status: 'pending' });
    await fireEvent.press(screen.getByLabelText('Low stock products: 4'));
    await fireEvent.press(screen.getByLabelText('Unread alerts: 5'));
    expect([onOpenLowStock.mock.calls.length, onOpenAlerts.mock.calls.length]).toEqual([1, 1]);
  });

  it('leaves out what the role does not get, and has an empty state', async () => {
    const numbers = dashboard({ salesToday: null, salesThisWeek: null, revenueThisMonth: null, lowStockProducts: null, recentOrders: [] });
    const app = await setup({ role: 'support', handler: answers(numbers) });
    await app.show(<DashboardScreen {...dashboardProps} />);
    expect(await screen.findByText('No orders yet')).toBeTruthy();
    expect(screen.queryByText('Sales today')).toBeNull();
    expect(screen.queryByText('Low stock products')).toBeNull();
    expect(screen.getByText('Your role: Support')).toBeTruthy();
  });

  it('shows an error with a retry when nothing is cached', async () => {
    let down = true;
    const app = await setup({ handler: (r) => (r.path.endsWith('/dashboard') && down ? 'offline' : answers()(r)) });
    await app.show(<DashboardScreen {...dashboardProps} />);
    expect(await screen.findByText('No connection to the server.')).toBeTruthy();
    down = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Orders today: 3')).toBeTruthy();
  });

  it('tells an account with no store what to do', async () => {
    const app = await setup({ stores: [] });
    await app.show(<DashboardScreen {...dashboardProps} />);
    expect(await screen.findByText('No store yet')).toBeTruthy();
  });
});

describe('orders list', () => {
  const list = (r: Seen) => (r.path.endsWith('/orders') ? { body: orderPage(r.query.q === 'ZZZ' ? [] : [orderItem(1), orderItem(2, { total: 400 })]) } : undefined);

  it('lists orders and sends the status, payment and search filters', async () => {
    const app = await setup({ handler: list });
    const open = jest.fn();
    await app.show(<OrdersScreen onOpenOrder={open} />);
    await fireEvent.press(await screen.findByLabelText('Order ORD-1001, Pending, Rs 2,500'));
    expect(open).toHaveBeenCalledWith(orderItem(1).id);
    expect(app.requests('/orders')[0]!.query).toEqual({ page: '1', limit: '20' });

    await fireEvent.press(screen.getByRole('button', { name: 'Confirmed (0)' }));
    await waitFor(() => expect(app.requests('/orders').at(-1)!.query.status).toBe('confirmed'));
    await fireEvent.press(screen.getByRole('button', { name: 'COD' }));
    await waitFor(() => expect(app.requests('/orders').at(-1)!.query).toMatchObject({ status: 'confirmed', payment: 'cod' }));

    await fireEvent.changeText(screen.getByLabelText('Search by order number'), 'ZZZ');
    await fireEvent(screen.getByLabelText('Search by order number'), 'submitEditing');
    expect(await screen.findByText('Nothing matches these filters.')).toBeTruthy();
    expect(app.requests('/orders').at(-1)!.query.q).toBe('ZZZ');
  });

  it('opens with the filter the dashboard asked for', async () => {
    const app = await setup({ handler: list });
    await app.show(<OrdersScreen onOpenOrder={nothing} initialStatus="pending" />);
    await screen.findByLabelText('Order ORD-1001, Pending, Rs 2,500');
    expect(app.requests('/orders')[0]!.query.status).toBe('pending');
  });
});

describe('store switcher', () => {
  it('shows each store with the role and remembers the choice', async () => {
    const app = await setup({ stores: [storeRow(STORE, 'owner', 'First'), storeRow(STORE2, 'staff', 'Second')] });
    const done = jest.fn();
    await app.show(<StoresScreen onDone={done} />);
    expect(await screen.findByText('Your role: Staff')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Selected: First' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Open Second' }));
    expect(done).toHaveBeenCalled();
    expect(await app.storage.get(selectedStoreKey('u1'))).toBe(STORE2);
    expect(screen.getByRole('button', { name: 'Selected: Second' })).toBeTruthy();
  });
});
