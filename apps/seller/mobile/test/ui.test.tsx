import { render, screen } from '@testing-library/react-native';
import { OrderStatusBadge, PaymentBadge, StockBadge } from '../src/components/badges';
import { ProductRow } from '../src/components/product-row';
import { DashboardScreen, greeting } from '../src/screens/dashboard';
import { dashboard, setup, type Seen } from './harness';

/* S9-UI: the seller app's look. The behaviour of each screen is tested in the other files. */

// The photo, as a plain view that can be found.
jest.mock('expo-image', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- a jest.mock factory cannot use an import
  const { createElement } = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return { Image: () => createElement(View, { testID: 'product-photo' }) };
});

const nothing = () => undefined;
const product = (imageUrl: string | null) => ({
  id: '65c0000000000000000000a1',
  title: 'Shawl',
  status: 'draft',
  minPrice: 1500,
  totalStock: 3,
  stockStatus: 'low_stock',
  variantCount: 1,
  imageUrl,
  revision: 1,
  updatedAt: '2026-11-20T09:00:00.000Z',
});

describe('seller app look', () => {
  it('greets by the time of day and the first name', () => {
    expect(greeting('Ayesha Khan', new Date(2026, 10, 27, 9))).toBe('Good morning, Ayesha');
    expect(greeting('Ayesha', new Date(2026, 10, 27, 14))).toBe('Good afternoon, Ayesha');
    expect(greeting(null, new Date(2026, 10, 27, 20))).toBe('Good evening');
  });

  it('shows a package tile, not an empty box, for a product with no photo, and its stock and draft badges', async () => {
    await render(<ProductRow product={product(null)} onOpen={nothing} />);
    expect(screen.queryByTestId('product-photo')).toBeNull();
    expect(screen.getByText('Low stock · 3')).toBeTruthy();
    expect(screen.getByText('Draft')).toBeTruthy();
    await render(<ProductRow product={product('https://res.cloudinary.com/demo/image/upload/shawl.jpg')} onOpen={nothing} />);
    expect(screen.getByTestId('product-photo')).toBeTruthy();
  });

  it('labels the status, the payment and the stock in words, as the website does', async () => {
    await render(
      <>
        <OrderStatusBadge status="dispatched" />
        <PaymentBadge method="cod" status="unpaid" />
        <PaymentBadge method="cod" status="collected" />
        <PaymentBadge method="card" status="paid" />
        <StockBadge status="out_of_stock" />
      </>,
    );
    for (const word of ['Dispatched', 'COD', 'COD collected', 'Paid', 'Out of stock']) expect(screen.getByText(word)).toBeTruthy();
  });

  it('opens the Overview with the greeting and the numbers in cards', async () => {
    const app = await setup({ handler: (r: Seen) => (r.path.endsWith('/dashboard') ? { body: dashboard() } : r.path.endsWith('/alerts') ? { body: { docs: [], page: 1, limit: 1, totalDocs: 0, totalPages: 0, unread: 2 } } : undefined) });
    await app.show(<DashboardScreen onOpenOrder={nothing} onOpenOrders={nothing} onSwitchStore={nothing} onOpenLowStock={nothing} onOpenAlerts={nothing} onOpenPending={nothing} />);
    expect(await screen.findByText(/^Good (morning|afternoon|evening), Ayesha$/)).toBeTruthy();
    expect(screen.getByText('Recent orders')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Unread alerts: 2' })).toBeTruthy();
  });
});
