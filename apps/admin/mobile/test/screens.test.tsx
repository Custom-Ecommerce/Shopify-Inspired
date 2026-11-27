import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { OrderDetailScreen } from '../src/screens/order-detail';
import { OrdersScreen } from '../src/screens/orders';
import { OverviewScreen } from '../src/screens/overview';
import { PaymentDetailScreen } from '../src/screens/payment-detail';
import { OFFLINE_PAYMENTS, PaymentsScreen } from '../src/screens/payments';
import { SellersScreen } from '../src/screens/sellers';
import { SyncScreen } from '../src/screens/sync';
import { TicketDetailScreen } from '../src/screens/ticket-detail';
import { TicketsScreen } from '../src/screens/tickets';
import { ID, setup, type Seen } from './harness';

const nothing = () => undefined;
const AT = '2026-11-20T10:00:00.000Z';
afterEach(() => onlineManager.setOnline(true));
const goOffline = () => act(async () => onlineManager.setOnline(false));

const period = { gatewaySales: 5000, commission: 250, codCommission: 100, gatewayOrders: 2, codOrderValue: 8000, codOrders: 4 };
const overview = {
  stores: { total: 3, byStatus: { pending: 1, active: 2, suspended: 0, archived: 0 } },
  sellers: { total: 9, newInWindow: 4, windowDays: 30 },
  kpi: {
    periods: { today: period, last7: period, last30: { ...period, commission: 9000 } },
    ordersByPeriod: { today: 6, last7: 40, last30: 100 },
    unsettledBalance: 12000,
    ordersByStatus: { pending: 1, confirmed: 0, processing: 0, dispatched: 0, delivered: 0, cancelled: 0, returned: 0 },
    sellersByPlan: [],
    topStores: [],
  },
  outbox: { counts: { pending: 0, sent: 5, dead: 2 }, oldestPendingAt: null, lastSentAt: AT },
  generatedAt: AT,
};

const orderRow = { id: ID, orderNumber: 'MZ-1001', storeId: ID, storeName: 'Zara', status: 'pending', paymentMethod: 'cod', total: 3000, city: 'Lahore', itemCount: 1, createdAt: AT, updatedAt: AT };
const orderDetail = {
  ...orderRow,
  items: [{ name: 'Shawl', quantity: 2, unitPrice: 1200, lineTotal: 2400 }],
  totals: { subtotal: 2400, discount: 0, delivery: 200, total: 3000, tax: 400, taxLabel: 'GST', taxIncluded: false },
  statusHistory: [],
  paymentStatus: 'unpaid',
  confirmationStatus: 'unconfirmed',
};
const orderList = { docs: [orderRow], page: 1, limit: 20, totalDocs: 1, totalPages: 1 };

describe('overview and orders', () => {
  it('shows the sales, commission with its COD part, new sellers and sync', async () => {
    const app = await setup({ level: 'finance', handler: (r) => (r.path === '/api/admin/overview' ? { body: overview } : undefined) });
    await app.show(<OverviewScreen />);
    expect(await screen.findByText('Rs 9,000')).toBeTruthy();
    expect(screen.getAllByText('of which on COD')).toHaveLength(3);
    expect(screen.getByText('New sellers (30 days)')).toBeTruthy();
    expect(screen.getByText('Rs 12,000')).toBeTruthy();
  });

  it('opens from the saved copy without a network, clearly marked, and says so when there is none', async () => {
    const app = await setup({ handler: (r) => (r.path === '/api/admin/overview' ? { body: overview } : r.path === '/api/admin/orders' ? { body: orderList } : undefined) });
    const first = await app.show(<OverviewScreen />);
    await screen.findByText('Rs 12,000');
    await first.unmount();
    await goOffline();
    await app.show(<OverviewScreen />);
    expect(await screen.findByText(/^Offline\. This is saved data from .+ may be out of date\.$/)).toBeTruthy();
    expect(screen.getByText('Rs 12,000')).toBeTruthy();
    await app.show(<OrdersScreen onOpenOrder={nothing} />);
    expect(await screen.findByText('No connection')).toBeTruthy();
  });

  it('lists orders with a status filter and shows one with its tax line, with no shopper details', async () => {
    const app = await setup({
      level: 'customer_support',
      handler: (r) => (r.path === '/api/admin/orders' ? { body: orderList } : r.path.endsWith(`/orders/${ID}`) ? { body: { order: orderDetail } } : undefined),
    });
    const open = jest.fn();
    const list = await app.show(<OrdersScreen onOpenOrder={open} />);
    await fireEvent.press(await screen.findByLabelText('MZ-1001, Rs 3,000'));
    expect(open).toHaveBeenCalledWith(ID);
    await fireEvent.press(screen.getByRole('button', { name: 'Delivered' }));
    await waitFor(() => expect(app.requests('/api/admin/orders').at(-1)!.query.status).toBe('delivered'));
    await list.unmount();
    await app.show(<OrderDetailScreen orderId={ID} />);
    expect(await screen.findByText('GST')).toBeTruthy();
    expect(screen.getByText('Rs 400')).toBeTruthy();
    expect(screen.queryByText(/Phone$|Address/)).toBeNull();
  });

  it('refuses an order answer that carries a shopper detail', async () => {
    const app = await setup({ handler: (r) => (r.path === '/api/admin/orders' ? { body: { ...orderList, docs: [{ ...orderRow, phone: '+923001234567' }] } } : undefined) });
    await app.show(<OrdersScreen onOpenOrder={nothing} />);
    expect(await screen.findByText('The server sent an answer this app cannot read.')).toBeTruthy();
    expect(screen.queryByText(/923001234567/)).toBeNull();
  });
});

const payment = {
  id: ID,
  seller: { id: ID, name: 'Ayesha', email: 'a@x.pk' },
  planKey: 'growth',
  planName: 'Growth',
  amountRs: 2500,
  status: 'claimed',
  method: 'jazzcash',
  reference: 'TX-1',
  proofUrl: 'http://insecure.example/p.jpg',
  periodStart: null,
  periodEnd: null,
  reason: null,
  decidedBy: null,
  decidedAt: null,
  createdAt: AT,
  claimedAt: AT,
  revision: 1,
};
const payments = { docs: [payment], page: 1, limit: 100, totalDocs: 1, totalPages: 1, pendingCount: 1 };
const paying = (decision?: (r: Seen) => ReturnType<NonNullable<Parameters<typeof setup>[0]>['handler'] & object>) => (r: Seen) =>
  r.method === 'GET' && r.path.endsWith('/subscription-payments') ? { body: payments } : r.method === 'POST' ? decision?.(r) : undefined;

describe('subscription payments', () => {
  it('lists the claims waiting and opens one', async () => {
    const app = await setup({ level: 'finance', handler: paying() });
    const open = jest.fn();
    await app.show(<PaymentsScreen onOpenPayment={open} />);
    await fireEvent.press(await screen.findByLabelText('Ayesha, Rs 2,500'));
    expect(open).toHaveBeenCalledWith(ID);
    expect(app.requests('/subscription-payments')[0]!.query).toMatchObject({ status: 'claimed' });
  });

  it('confirms with the amount shown and a reason, only after asking', async () => {
    const app = await setup({ level: 'finance', handler: paying(() => ({ body: { payment } })) });
    const asked: { message: string; run: () => void }[] = [];
    await app.show(<PaymentDetailScreen paymentId={ID} confirm={(_title, message, _action, run) => asked.push({ message, run })} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Confirm payment' }));
    expect(screen.getByText('Write a reason of at least 3 characters.')).toBeTruthy();
    expect(asked).toHaveLength(0);
    await fireEvent.changeText(screen.getByLabelText('Reason (kept in the audit log)'), 'Seen in JazzCash');
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm payment' }));
    expect(asked[0]!.message).toContain('Rs 2,500 from Ayesha');
    expect(app.requests('/confirm', 'POST')).toHaveLength(0);
    // A proof that is not https is not offered.
    expect(screen.queryByRole('button', { name: 'Open the payment proof' })).toBeNull();
    await act(async () => asked[0]!.run());
    expect(await screen.findByText('Payment of Rs 2,500 confirmed.')).toBeTruthy();
    expect(app.requests(`/subscription-payments/${ID}/confirm`, 'POST')[0]!.body).toEqual({ amountRs: 2500, reason: 'Seen in JazzCash' });
  });

  it('rejects with a reason, and shows what the server refuses', async () => {
    const app = await setup({ handler: paying(() => ({ status: 409, body: { error: 'This payment was already decided.', code: 'PAYMENT_ALREADY_DECIDED' } })) });
    await app.show(<PaymentDetailScreen paymentId={ID} confirm={(_t, _m, _a, run) => run()} />);
    await fireEvent.changeText(await screen.findByLabelText('Reason (kept in the audit log)'), 'No money received');
    await fireEvent.press(screen.getByRole('button', { name: 'Reject payment' }));
    expect(await screen.findByText('This payment was already decided.')).toBeTruthy();
    expect(app.requests(`/${ID}/reject`, 'POST')[0]!.body).toEqual({ reason: 'No money received' });
    await waitFor(() => expect(app.requests('/subscription-payments', 'GET').length).toBeGreaterThan(1));
  });

  it('is online only: offline says so, sends nothing and queues nothing', async () => {
    const app = await setup({ handler: paying() });
    await goOffline();
    await app.show(<PaymentDetailScreen paymentId={ID} />);
    expect(screen.getByText(OFFLINE_PAYMENTS)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm payment' })).toBeNull();
    await app.show(<PaymentsScreen onOpenPayment={nothing} />);
    expect(app.seen.filter((r) => r.path.includes('subscription-payments'))).toHaveLength(0);
    expect(app.runtime.queue()!.list()).toHaveLength(0);
  });

  it('says nothing was queued when a decision gets no answer', async () => {
    const app = await setup({ handler: paying(() => 'offline') });
    await app.show(<PaymentDetailScreen paymentId={ID} confirm={(_t, _m, _a, run) => run()} />);
    await fireEvent.changeText(await screen.findByLabelText('Reason (kept in the audit log)'), 'Seen in bank');
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm payment' }));
    expect(await screen.findByText(/Nothing was queued/)).toBeTruthy();
    expect(app.requests('/confirm', 'POST')).toHaveLength(1);
    expect(app.runtime.queue()!.list()).toHaveLength(0);
  });
});

const ticket = { id: ID, subject: 'Cannot upload', status: 'open', revision: 3, messageCount: 1, lastMessageAt: AT, lastFrom: 'seller', orderRef: null, sellerName: 'Ayesha', sellerEmail: 'a@x.pk' };
const ticketFull = { ...ticket, messages: [{ from: 'seller', text: 'The photo fails', at: AT, byId: 'x' }] };

describe('tickets', () => {
  it('lists open tickets, filters, and opens one', async () => {
    const app = await setup({ level: 'customer_support', handler: (r) => (r.path.endsWith('/tickets') ? { body: { docs: [ticket], page: 1, totalPages: 1 } } : undefined) });
    const open = jest.fn();
    await app.show(<TicketsScreen onOpenTicket={open} />);
    await fireEvent.press(await screen.findByLabelText('Cannot upload'));
    expect(open).toHaveBeenCalledWith(ID);
    expect(app.requests('/tickets')[0]!.query.status).toBe('open');
    await fireEvent.press(screen.getByRole('button', { name: 'Closed' }));
    await waitFor(() => expect(app.requests('/tickets').at(-1)!.query.status).toBe('closed'));
  });

  it('replies and changes the status with the revision it saw; a conflict is shown', async () => {
    let revision = 3;
    const app = await setup({
      level: 'customer_support',
      handler: (r) => {
        if (r.method === 'GET' && r.path.endsWith(`/tickets/${ID}`)) return { body: { ticket: { ...ticketFull, revision } } };
        if (r.path.endsWith('/reply')) {
          revision = 4;
          return { body: { ticket: ticketFull } };
        }
        if (r.path.endsWith('/status')) return { status: 409, body: { error: 'This ticket was changed somewhere else.', code: 'TICKET_REVISION_CONFLICT' } };
        return undefined;
      },
    });
    await app.show(<TicketDetailScreen ticketId={ID} />);
    expect(await screen.findByText('The photo fails')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Your reply (the seller is emailed)'), '  Try again now  ');
    await fireEvent.press(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(app.requests('/reply', 'POST')[0]!.body).toEqual({ revision: 3, text: 'Try again now' }));
    await waitFor(() => expect(screen.getByLabelText('Your reply (the seller is emailed)').props.value).toBe(''));
    await fireEvent.press(screen.getByRole('button', { name: 'Set closed' }));
    expect(await screen.findByText('This ticket was changed somewhere else. The latest version is shown.')).toBeTruthy();
    expect(app.requests('/status', 'POST')[0]!.body).toEqual({ revision: 4, status: 'closed' });
  });

  it('cannot reply offline', async () => {
    const app = await setup({ handler: (r) => (r.path.endsWith(`/tickets/${ID}`) ? { body: { ticket: ticketFull } } : undefined) });
    await app.show(<TicketDetailScreen ticketId={ID} />);
    await screen.findByText('The photo fails');
    await goOffline();
    expect(screen.getByText('Offline. Replying and changing the status need a connection.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Your reply (the seller is emailed)'), 'x');
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeDisabled();
  });
});

describe('sellers and sync (read only)', () => {
  it('lists sellers with their stores and searches', async () => {
    const seller = { id: ID, name: 'Ayesha', email: 'a@x.pk', storeCount: 1, createdAt: AT, accountStatus: 'active', stores: [{ id: ID, name: 'Zara', status: 'active' }] };
    const app = await setup({ level: 'operations', handler: (r) => (r.path.endsWith('/sellers') ? { body: { docs: [seller], page: 1, totalPages: 1 } } : undefined) });
    await app.show(<SellersScreen />);
    expect(await screen.findByText('1 store: Zara (active)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Suspend|Ayesha/ })).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Search name or email'), 'zara');
    await fireEvent(screen.getByLabelText('Search name or email'), 'submitEditing');
    await waitFor(() => expect(app.requests('/sellers').at(-1)!.query.q).toBe('zara'));
  });

  it('shows the events that failed', async () => {
    const sync = {
      counts: { pending: 1, sent: 10, dead: 1 },
      oldestPendingAt: AT,
      lastSentAt: AT,
      status: 'dead',
      events: { docs: [{ id: 'e1', entity: 'store', target: 'seller', attempts: 8, lastError: 'timeout', createdAt: AT }] },
    };
    const app = await setup({ level: 'operations', handler: (r) => (r.path.endsWith('/sync/outbox') ? { body: sync } : undefined) });
    await app.show(<SyncScreen />);
    expect(await screen.findByText('store to seller, 8 tries')).toBeTruthy();
    expect(screen.getByText('Retry them from the console.')).toBeTruthy();
  });
});
