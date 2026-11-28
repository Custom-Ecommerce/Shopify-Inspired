import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { createPhonePush, routeForPush } from '../src/push';
import { PushWiring } from '../src/push-wiring';
import { NotificationSettingsScreen } from '../src/screens/notification-settings';
import { selectedStoreKey } from '../src/services';
import { fakePush, ORDER, setup, STORE, STORE2, storeRow, type Seen } from './harness';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.0.0' } } }));
jest.mock('expo-notifications', () => {
  throw new Error('the notifications library must not be loaded in Expo Go');
});

describe('push', () => {
  it('opens only the screens the API names, with well formed ids', () => {
    expect(routeForPush({ screen: 'order', storeId: STORE, orderId: ORDER })).toEqual({ path: `/orders/${ORDER}`, storeId: STORE });
    expect(routeForPush({ screen: 'order', storeId: STORE, orderId: '../stores' })).toBeNull();
    expect(routeForPush({ screen: 'order', orderId: ORDER })).toBeNull();
    expect(routeForPush({ screen: 'billing' })).toEqual({ path: '/', storeId: null });
    expect(routeForPush({ screen: 'inventory', storeId: STORE })).toEqual({ path: '/products?stock=low', storeId: STORE });
    expect(routeForPush({ screen: 'https://evil.example' })).toBeNull();
    expect(routeForPush(null)).toBeNull();
  });

  it('does not even load the library in Expo Go', async () => {
    const push = createPhonePush(() => true);
    expect(push.available()).toMatchObject({ ok: false });
    await expect(push.register()).resolves.toMatchObject({ ok: false });
    expect(() => push.onTap(() => undefined)()).not.toThrow();
  });

  it('says a build without a project id cannot register', () => {
    expect(createPhonePush(() => false).available()).toEqual({ ok: false, reason: 'This build is not set up for push notifications yet.' });
  });

  it('registers the phone after sign-in and opens a tapped order in its store', async () => {
    let tap: (data: unknown) => void = () => undefined;
    const push = fakePush({
      register: async () => ({ ok: true, token: 'ExponentPushToken[aaaaaaaaaaaaaaaa]' }),
      onTap: (handler) => {
        tap = handler;
        // A notification that opened the app: delivered before the stores are known.
        handler({ screen: 'order', storeId: STORE2, orderId: ORDER });
        return () => undefined;
      },
    });
    const app = await setup({
      push,
      stores: [storeRow(STORE), storeRow(STORE2, 'staff', 'Second')],
      handler: (r: Seen) => (r.path.endsWith('/push-token') ? { body: { ok: true, registered: true } } : undefined),
    });
    const open = jest.fn();
    await app.show(<PushWiring open={open} delayMs={0} />);
    await waitFor(() => expect(open).toHaveBeenCalledWith(`/orders/${ORDER}`));
    expect(open).toHaveBeenCalledTimes(1);
    expect(await app.storage.get(selectedStoreKey('u1'))).toBe(STORE2);
    await waitFor(() => expect(app.requests('/push-token', 'POST')[0]!.body).toEqual({ token: 'ExponentPushToken[aaaaaaaaaaaaaaaa]' }));

    // A store the account is not in opens nothing.
    tap({ screen: 'order', storeId: '65b000000000000000000099', orderId: ORDER });
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('notification settings', () => {
  const settings = (over: object = {}) => ({ muted: false, mutedKinds: [], kinds: ['order_new', 'low_stock'], ...over });

  it('mutes one kind and sets quiet hours, and says why push is off in Expo Go', async () => {
    let stored: object = settings();
    const app = await setup({
      handler: (r) => {
        if (!r.path.endsWith('/push-settings')) return undefined;
        if (r.method === 'PATCH') stored = { ...stored, ...r.body };
        return { body: stored };
      },
    });
    await app.show(<NotificationSettingsScreen />);
    expect(await screen.findByText(/Expo Go cannot receive push/)).toBeTruthy();
    await fireEvent(screen.getByLabelText('Low stock'), 'valueChange', false);
    await waitFor(() => expect(app.requests('/push-settings', 'PATCH')[0]!.body).toEqual({ mutedKinds: ['low_stock'] }));

    await fireEvent(screen.getByLabelText('Use quiet hours'), 'valueChange', true);
    await waitFor(() => expect(app.requests('/push-settings', 'PATCH')[1]!.body).toEqual({ quietHours: { start: '22:00', end: '08:00' } }));
    await fireEvent.changeText(await screen.findByLabelText('From (HH:MM)'), '9pm');
    await fireEvent.press(screen.getByRole('button', { name: 'Save quiet hours' }));
    expect(screen.getByText(/Write both times as HH:MM/)).toBeTruthy();
    expect(app.requests('/push-settings', 'PATCH')).toHaveLength(2);
  });
});
