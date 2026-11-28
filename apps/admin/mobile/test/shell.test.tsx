import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { adminCan, ADMIN_LEVELS } from '@markaz/auth/admin-levels';
import { moreFor, tabsFor } from '../src/access';
import { routeForAdminPush } from '../src/push';
import { PushWiring } from '../src/push-wiring';
import { Gate } from '../src/components/gate';
import { MoreScreen } from '../src/screens/more';
import { RecoveryCodesScreen } from '../src/screens/recovery-codes';
import { SignInScreen } from '../src/screens/sign-in';
import { shouldPersistAdmin } from '../src/services';
import { fakePush, ID, setup, signInAnswer, type Seen } from './harness';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.0.0' } } }));

const nothing = () => undefined;
const secret = 'JBSWY3DPEHPK3PXPJBSWY3DP';

async function typeCredentials() {
  await fireEvent.changeText(screen.getByLabelText('Email'), 'Admin@X.pk');
  await fireEvent.changeText(screen.getByLabelText('Password'), 'long-password');
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
}

describe('admin sign-in', () => {
  it('asks for the password, then the authenticator code, or a recovery code', async () => {
    const app = await setup({
      signIn: false,
      handler: (r: Seen) => {
        if (!r.path.endsWith('/auth/login')) return undefined;
        if (!r.body.totp && !r.body.recoveryCode) return { status: 403, body: { error: 'Enter the code', code: 'TOTP_REQUIRED' } };
        if (r.body.totp === '000000') return { status: 401, body: { error: 'That code is not right.', code: 'TOTP_INVALID' } };
        return { body: signInAnswer('owner') };
      },
    });
    await app.show(<SignInScreen />);
    await typeCredentials();
    await fireEvent.changeText(await screen.findByLabelText('6 digit code'), '12');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter the 6 digit code.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('6 digit code'), '000 000');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('That code is not right.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Use a recovery code' }));
    await fireEvent.changeText(screen.getByLabelText('Recovery code'), 'abcd-efgh-ij');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(app.runtime.session.getState().status).toBe('signed_in'));
    expect(app.requests('/auth/login').at(-1)!.body).toMatchObject({ email: 'admin@x.pk', recoveryCode: 'abcd-efgh-ij', platform: 'android' });
    expect(app.requests('/auth/login')[0]!.path).toBe('/api/admin/mobile/v1/auth/login');
    expect(app.recovery.get()).toBeNull();
  });

  it('sets the authenticator up on a first sign-in and hands over the recovery codes once', async () => {
    const app = await setup({
      signIn: false,
      handler: (r: Seen) => {
        if (!r.path.endsWith('/auth/login')) return undefined;
        if (!r.body.totp) return { status: 403, body: { error: 'Set up', code: 'TOTP_ENROLMENT_REQUIRED', enrolment: { secret, otpauthUri: `otpauth://totp/Markazify:a?secret=${secret}` } } };
        return { body: signInAnswer('owner', { recoveryCodes: ['aaaa-bbbb-cc', 'dddd-eeee-ff'] }) };
      },
    });
    const opened = jest.fn(async () => undefined);
    await app.show(<SignInScreen openLink={opened} />);
    await typeCredentials();
    expect(await screen.findByText(secret)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Open the authenticator app' }));
    expect(opened).toHaveBeenCalledWith(`otpauth://totp/Markazify:a?secret=${secret}`);
    await fireEvent.changeText(screen.getByLabelText('6 digit code'), '123456');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(app.recovery.get()).toEqual(['aaaa-bbbb-cc', 'dddd-eeee-ff']));
    // Nothing of the second factor is written to the phone.
    expect([...app.storage.data.values()].join('')).not.toContain(secret);
    expect([...app.storage.data.values()].join('')).not.toContain('aaaa-bbbb-cc');
  });

  it('shows the codes until the admin says they are saved', async () => {
    const saved = jest.fn();
    const app = await setup();
    await app.show(<RecoveryCodesScreen codes={['aaaa-bbbb-cc']} onSaved={saved} />);
    expect(screen.getByText('aaaa-bbbb-cc')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'I have saved them' }));
    expect(saved).toHaveBeenCalled();
  });
});

describe('levels', () => {
  it('gives each level its tabs, and never one it may not use', () => {
    expect(tabsFor('owner')).toEqual(['overview', 'orders', 'payments', 'tickets']);
    expect(moreFor('owner')).toEqual(['sellers', 'sync']);
    expect(tabsFor('finance')).toEqual(['overview', 'payments']);
    expect(moreFor('finance')).toEqual([]);
    expect(tabsFor('operations')).toEqual(['overview', 'sellers', 'sync']);
    expect(tabsFor('customer_support')).toEqual(['orders', 'tickets']);
    expect(moreFor('customer_support')).toEqual(['sellers']);
    expect(tabsFor(null)).toEqual([]);
    const needs = { overview: 'overview.read', orders: 'orders.read', payments: 'payments.read', tickets: 'tickets.read', sellers: 'sellers.read', sync: 'sync.read' } as const;
    for (const level of ADMIN_LEVELS) for (const tab of [...tabsFor(level), ...moreFor(level)]) expect(adminCan(level, needs[tab])).toBe(true);
  });

  it('refuses a screen opened by a link when the level lacks it', async () => {
    const app = await setup({ level: 'finance' });
    await app.show(
      <Gate screen="tickets">
        <MoreScreen onOpen={nothing} onOpenNotificationSettings={nothing} />
      </Gate>,
    );
    expect(await screen.findByText('Not available for your level')).toBeTruthy();
  });

  it('lists the extra screens under More, the account and the devices, and asks before signing out', async () => {
    const app = await setup({ handler: (r) => (r.path.endsWith('/devices') ? { body: { devices: [] } } : undefined) });
    const open = jest.fn();
    let run: () => void = nothing;
    await app.show(<MoreScreen onOpen={open} onOpenNotificationSettings={nothing} confirm={(_t, _m, _a, go) => (run = go)} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Sync' }));
    expect(open).toHaveBeenCalledWith('sync');
    expect(screen.getByText('Owner')).toBeTruthy();
    await waitFor(() => expect(app.requests('/api/admin/mobile/v1/devices')).toHaveLength(1));
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    expect(app.runtime.session.getState().status).toBe('signed_in');
    run();
    await waitFor(() => expect(app.runtime.session.getState().status).toBe('signed_out'));
  });

  it('saves only the overview, the orders and the level on the phone', () => {
    for (const kind of ['overview', 'orders', 'order', 'me']) expect(shouldPersistAdmin(['user', 'u1', kind])).toBe(true);
    for (const kind of ['payments', 'tickets', 'ticket', 'sellers', 'sync', 'devices', 'push-settings']) expect(shouldPersistAdmin(['user', 'u1', kind])).toBe(false);
  });
});

describe('push', () => {
  it('opens the ticket, the payment or the sync screen, and nothing else', () => {
    expect(routeForAdminPush({ screen: 'ticket', ticketId: ID })).toBe(`/tickets/${ID}`);
    expect(routeForAdminPush({ screen: 'payment', paymentId: ID })).toBe(`/payments/${ID}`);
    expect(routeForAdminPush({ screen: 'sync' })).toBe('/sync');
    expect(routeForAdminPush({ screen: 'ticket', ticketId: '../users' })).toBeNull();
    expect(routeForAdminPush({ screen: 'users' })).toBeNull();
  });

  it('registers after sign-in with the admin route and opens a tapped ticket', async () => {
    const open = jest.fn();
    const app = await setup({
      push: fakePush({
        register: async () => ({ ok: true, token: 'ExponentPushToken[aaaaaaaaaaaaaaaa]' }),
        onTap: (handler) => {
          handler({ screen: 'ticket', ticketId: ID });
          return () => undefined;
        },
      }),
      handler: (r) => (r.path.endsWith('/push-token') ? { body: { ok: true, registered: true } } : undefined),
    });
    await app.show(<PushWiring open={open} delayMs={0} />);
    expect(open).toHaveBeenCalledWith(`/tickets/${ID}`);
    await waitFor(() => expect(app.requests('/api/admin/mobile/v1/devices/push-token', 'POST')).toHaveLength(1));
  });
});
