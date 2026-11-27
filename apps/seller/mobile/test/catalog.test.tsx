import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { sizedImageUrl } from '../src/image-url';
import { displayPhone } from '../src/labels';
import { AlertsScreen, routeForAlert } from '../src/screens/alerts';
import { CustomerDetailScreen } from '../src/screens/customer-detail';
import { CustomersScreen } from '../src/screens/customers';
import { ProductDetailScreen } from '../src/screens/product-detail';
import { ProductsScreen } from '../src/screens/products';
import { SettingsScreen } from '../src/screens/settings';
import { ORDER, setup, STORE, type Seen } from './harness';

jest.mock('expo-image', () => ({ Image: () => null }));

const PRODUCT = '65d000000000000000000001';
const VARIANT = '65e000000000000000000001';
const STAMP = { revision: 100, updatedAt: '2026-11-20T10:00:00.000Z' };
const nothing = () => undefined;

const variant = (over: object = {}) => ({
  id: VARIANT,
  title: 'Default',
  sku: 'S-1',
  price: 1500,
  compareAtPrice: null,
  trackQuantity: true,
  stockQuantity: 10,
  availability: 'in_stock',
  ...STAMP,
  ...over,
});
const productRow = (over: object = {}) => ({
  id: PRODUCT,
  title: 'Shawl',
  status: 'published',
  minPrice: 1500,
  totalStock: 10,
  stockStatus: 'in_stock',
  variantCount: 1,
  imageUrl: null,
  ...STAMP,
  ...over,
});
const productDetail = (over: object = {}, variantOver: object = {}) => ({
  ...productRow(),
  description: 'Warm.',
  variants: [variant(variantOver)],
  media: [],
  ...over,
});
const page = (docs: unknown[], extra: object = {}) => ({ docs, page: 1, limit: 20, totalDocs: docs.length, totalPages: docs.length ? 1 : 0, ...extra });
const reading = (r: Seen) => (r.method === 'GET' && r.path.endsWith(`/products/${PRODUCT}`) ? { body: productDetail() } : undefined);

describe('products', () => {
  it('lists products with search and the status and low stock filters', async () => {
    const app = await setup({ handler: (r) => (r.path.endsWith('/products') ? { body: page([productRow()]) } : undefined) });
    const open = jest.fn();
    await app.show(<ProductsScreen onOpenProduct={open} />);
    await fireEvent.press(await screen.findByLabelText('Product Shawl, Rs 1,500, In stock'));
    expect(open).toHaveBeenCalledWith(PRODUCT);
    await fireEvent.press(screen.getByRole('button', { name: 'Low stock' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Draft' }));
    await waitFor(() => expect(app.requests('/products').at(-1)!.query).toMatchObject({ stock: 'low', status: 'draft' }));
    expect(screen.getByText('New products and photos are added on the website.')).toBeTruthy();
  });

  it('is not there for a role without products, which asks for nothing', async () => {
    const app = await setup({ role: 'support' });
    await app.show(<ProductsScreen onOpenProduct={nothing} />);
    expect(await screen.findByText('Not available for your role')).toBeTruthy();
    expect(app.requests('/products')).toHaveLength(0);
  });

  it('saves the count taken, with the revision seen and a key', async () => {
    const app = await setup({
      handler: (r) => (r.method === 'POST' ? { body: { changed: true, product: productDetail({ revision: 200 }, { stockQuantity: 7, revision: 200 }) } } : reading(r)),
    });
    await app.show(<ProductDetailScreen productId={PRODUCT} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Count stock: Shawl' }));
    await fireEvent.changeText(screen.getByLabelText('Count on the shelf now'), '7x');
    await fireEvent.press(screen.getByRole('button', { name: 'Save count' }));
    expect(screen.getByText('Enter the count as a whole number.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Count on the shelf now'), '7');
    await fireEvent.press(screen.getByRole('button', { name: 'Save count' }));
    expect(await screen.findByText('7')).toBeTruthy();
    const sent = app.requests('/stock', 'POST')[0]!;
    expect(sent.body).toEqual({ revision: 100, variantId: VARIANT, quantity: 7 });
    expect(sent.headers['idempotency-key']).toBeTruthy();
  });

  it('on a conflict shows the server value, keeps nothing, and lets the seller save again', async () => {
    let first = true;
    const app = await setup({
      handler: (r) => {
        if (r.method !== 'POST') return reading(r);
        if (first) {
          first = false;
          return { status: 409, body: { code: 'CONFLICT', errors: [{ message: 'changed' }], current: productDetail({ revision: 300 }, { stockQuantity: 4, revision: 300 }) } };
        }
        return { body: { changed: true, product: productDetail({ revision: 400 }, { stockQuantity: 7, revision: 400 }) } };
      },
    });
    await app.show(<ProductDetailScreen productId={PRODUCT} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Count stock: Shawl' }));
    await fireEvent.changeText(screen.getByLabelText('Count on the shelf now'), '7');
    await fireEvent.press(screen.getByRole('button', { name: 'Save count' }));
    expect(await screen.findByText(/now 4 in stock\). Your count 7 was not saved/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Save count' }));
    await waitFor(() => expect(app.requests('/stock', 'POST')).toHaveLength(2));
    const [one, two] = app.requests('/stock', 'POST');
    expect(two!.body.revision).toBe(300);
    expect(two!.headers['idempotency-key']).not.toBe(one!.headers['idempotency-key']);
  });

  it('changes a price and can remove the old price', async () => {
    const app = await setup({
      handler: (r) => (r.method === 'POST' ? { body: { changed: true, product: productDetail({}, { price: 1400 }) } } : reading(r)),
    });
    await app.show(<ProductDetailScreen productId={PRODUCT} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Change price: Shawl' }));
    await fireEvent.changeText(screen.getByLabelText('New price (Rs)'), '1400');
    await fireEvent.press(screen.getByRole('button', { name: 'Save price' }));
    await waitFor(() => expect(app.requests('/price', 'POST')[0]!.body).toEqual({ revision: 100, variantId: VARIANT, price: 1400, compareAtPrice: null }));
  });
});

const customer = {
  id: '+923001234567',
  name: null,
  email: null,
  phone: '+923001234567',
  whatsapp: null,
  orderCount: 3,
  deliveredCount: 1,
  totalSpent: 4000,
  lastOrderAt: '2026-11-20T10:00:00.000Z',
  tags: [],
  ...STAMP,
};

describe('customers', () => {
  it('lists them with the phone as the website writes it, and sorts', async () => {
    const app = await setup({ handler: (r) => (r.path.endsWith('/customers') ? { body: page([customer]) } : undefined) });
    const open = jest.fn();
    await app.show(<CustomersScreen onOpenCustomer={open} />);
    await fireEvent.press(await screen.findByLabelText('Customer 0300 1234567'));
    expect(open).toHaveBeenCalledWith('+923001234567');
    await fireEvent.press(screen.getByRole('button', { name: 'Spent most' }));
    await waitFor(() => expect(app.requests('/customers').at(-1)!.query.sort).toBe('total_spent'));
    expect(displayPhone('+4420000000')).toBe('+4420000000');
  });

  it('shows one customer read-only, asking with the key encoded', async () => {
    const detail = {
      id: customer.id,
      name: 'Sana',
      email: 'sana@example.com',
      phone: customer.phone,
      whatsapp: null,
      unsubscribed: false,
      stats: { orderCount: 3, deliveredCount: 1, cancelledCount: 0, totalSpent: 4000, averageOrderValue: 4000, firstOrderAt: null, lastOrderAt: null, returnsCount: 0 },
      note: 'Calls after 5',
      tags: ['vip'],
      noteUpdatedAt: null,
      orders: [{ id: ORDER, orderId: 'ORD-1001', createdAt: '2026-11-20T10:00:00.000Z', status: 'delivered', total: 4000, paymentMethod: 'cod', paymentStatus: 'collected' }],
      addresses: [{ address: 'House 1', city: 'Lahore' }],
      ...STAMP,
    };
    const app = await setup({ handler: (r) => (r.path.includes('/customers/') ? { body: detail } : undefined) });
    const open = jest.fn();
    await app.show(<CustomerDetailScreen customerKey={customer.id} onOpenOrder={open} />);
    expect(await screen.findByText('Sana')).toBeTruthy();
    expect(screen.getByText('Calls after 5')).toBeTruthy();
    expect(app.seen.at(-1)!.path).toBe('/api/mobile/v1/customers/%2B923001234567');
    await fireEvent.press(screen.getByRole('button', { name: 'ORD-1001 · Delivered · Rs 4,000' }));
    expect(open).toHaveBeenCalledWith(ORDER);
    expect(screen.getByText('Notes, tags and blocking are changed on the website.')).toBeTruthy();
  });
});

describe('alerts', () => {
  const alert = (over: object = {}) => ({
    id: '65f000000000000000000001',
    kind: 'new_order',
    title: 'New order',
    body: 'ORD-1001',
    link: `/orders/${ORDER}`,
    readAt: null,
    createdAt: '2026-11-20T10:00:00.000Z',
    ...STAMP,
    ...over,
  });

  it('maps only the links the app has a screen for', () => {
    expect(routeForAlert(`/orders/${ORDER}`)).toBe(`/orders/${ORDER}`);
    expect(routeForAlert('/inventory')).toBe('/products?stock=low');
    expect(routeForAlert('/returns')).toBeNull();
    expect(routeForAlert('https://evil.example')).toBeNull();
    expect(routeForAlert(null)).toBeNull();
  });

  it('marks a tapped alert read and opens its order; marks all read', async () => {
    const app = await setup({
      handler: (r) =>
        r.path.endsWith('/alerts') ? { body: page([alert()], { unread: 1 }) } : r.method === 'POST' ? { body: { unread: 0 } } : undefined,
    });
    const open = jest.fn();
    await app.show(<AlertsScreen open={open} />);
    await fireEvent.press(await screen.findByLabelText('Unread: New order'));
    expect(open).toHaveBeenCalledWith(`/orders/${ORDER}`);
    await waitFor(() => expect(app.requests('/65f000000000000000000001/read', 'POST')).toHaveLength(1));
    await fireEvent.press(screen.getByRole('button', { name: 'Mark all 1 as read' }));
    await waitFor(() => expect(app.requests('/alerts/read-all', 'POST')[0]!.headers['x-store-id']).toBe(STORE));
  });
});

describe('settings', () => {
  const device = (id: string, name: string, current: boolean) => ({
    id,
    name,
    platform: 'android',
    appVersion: '1.0.0',
    lastSeenAt: '2026-11-20T10:00:00.000Z',
    createdAt: '2026-11-19T10:00:00.000Z',
    current,
  });
  const props = { onOpenNotificationSettings: nothing, onSwitchStore: nothing, onOpenAlerts: nothing, onOpenPending: nothing };

  it('lists the devices, signs another one out after asking, and links to support', async () => {
    const app = await setup({
      handler: (r) =>
        r.path.endsWith('/devices')
          ? { body: { devices: [device('d1', 'My phone', true), device('d2', 'Old phone', false)] } }
          : r.path.endsWith('/revoke')
            ? { body: { id: 'd2', revoked: true, changed: true } }
            : undefined,
    });
    const asked: (() => void)[] = [];
    const openLink = jest.fn();
    await app.show(<SettingsScreen {...props} confirm={(_title, _message, _action, run) => asked.push(run)} openLink={openLink} />);
    expect(await screen.findByText('My phone (this phone)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign out My phone' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out Old phone' }));
    expect(app.requests('/revoke', 'POST')).toHaveLength(0);
    asked[0]!();
    await waitFor(() => expect(app.requests('/devices/d2/revoke', 'POST')).toHaveLength(1));
    await fireEvent.press(await screen.findByRole('button', { name: 'Contact support' }));
    expect(openLink).toHaveBeenCalledWith(`https://seller.example/s/${STORE}/support`);
    expect(screen.getByText('1.0.0')).toBeTruthy();
  });

  it('warns about unsent changes before signing out', async () => {
    const app = await setup({ handler: (r) => (r.path.endsWith('/devices') ? { body: { devices: [] } } : undefined) });
    await app.runtime.queue()!.enqueue({ storeId: STORE, change: { kind: 'order.note', orderId: ORDER, text: 'x' }, revision: 1, label: 'Note' });
    const messages: string[] = [];
    let run: () => void = nothing;
    await app.show(
      <SettingsScreen
        {...props}
        confirm={(_title, message, _action, go) => {
          messages.push(message);
          run = go;
        }}
      />,
    );
    await fireEvent.press(await screen.findByRole('button', { name: 'Sign out' }));
    expect(messages).toEqual(['1 change has not been sent yet and will be lost.']);
    expect(app.runtime.session.getState().status).toBe('signed_in');
    run();
    await waitFor(() => expect(app.runtime.session.getState().status).toBe('signed_out'));
  });

  it('sizes Cloudinary photos and loads only https', () => {
    expect(sizedImageUrl('https://res.cloudinary.com/demo/image/upload/v1/a.jpg', 168)).toBe(
      'https://res.cloudinary.com/demo/image/upload/c_limit,w_168,h_168,q_auto,f_auto/v1/a.jpg',
    );
    expect(sizedImageUrl('https://cdn.example/a.jpg', 168)).toBe('https://cdn.example/a.jpg');
    expect(sizedImageUrl('http://insecure.example/a.jpg', 168)).toBeNull();
    expect(sizedImageUrl(null, 168)).toBeNull();
  });
});
