import { Banknote, CreditCard, ORDER_STATUS_TONES, PAYMENT_TONES, StatusBadge, STOCK_TONES, toneOf } from '@markaz/mobile-kit';
import { statusLabel, stockLabel } from '../labels';

/** The order's status as the website shows it: a pill with a coloured dot. */
export const OrderStatusBadge = ({ status }: { status: string }) => <StatusBadge label={statusLabel(status)} tone={toneOf(ORDER_STATUS_TONES, status)} />;

/** How the order is paid: COD (still to collect, or collected) or card (paid or not). */
export function PaymentBadge({ method, status }: { method: string | null | undefined; status: string }) {
  if (method === 'card') return <StatusBadge label={status === 'paid' ? 'Paid' : 'Card, unpaid'} tone={toneOf(PAYMENT_TONES, status)} icon={CreditCard} />;
  return <StatusBadge label={status === 'collected' ? 'COD collected' : 'COD'} tone={status === 'collected' ? 'success' : 'neutral'} icon={Banknote} />;
}

export const StockBadge = ({ status, count }: { status: string; count?: number }) => (
  <StatusBadge label={count === undefined ? stockLabel(status) : `${stockLabel(status)} · ${count}`} tone={toneOf(STOCK_TONES, status)} />
);
